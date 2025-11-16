"""
Main evaluation runner for chatbot evaluation suite.

This module loads test cases and clinic contexts, runs them through the chatbot,
and stores responses for evaluation.
"""

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Any

import yaml
from dotenv import load_dotenv

# Load .env file before importing modules that need it
backend_dir = Path(__file__).parent.parent
env_path = backend_dir / ".env"
if env_path.exists():
    load_dotenv(env_path)

# Add src directory to path to import from src
import sys

src_dir = backend_dir / "src"

# Add src to path if not already there
if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))

from models.clinic import Clinic, ClinicSettings, ChatSettings, ClinicInfoSettings
from services.clinic_agent.service import ClinicAgentService

logger = logging.getLogger(__name__)


class TestCase:
    """Represents a single test case."""
    
    def __init__(self, data: Dict[str, Any]):
        self.test_id = data["test_id"]
        self.category = data["category"]
        self.priority = data["priority"]
        self.description = data["description"]
        self.user_message = data.get("user_message") or data.get("user_messages", [])
        self.follow_up_messages = data.get("follow_up_messages", [])
        self.expected_behaviors = data.get("expected_behaviors", [])
        self.clinic_context_id = data.get("clinic_context_id", "minimal")  # Default to minimal if not specified
        self.evaluation_criteria = data.get("evaluation_criteria", [])
    
    def is_multi_turn(self) -> bool:
        """Check if this is a multi-turn test case."""
        return isinstance(self.user_message, list) or len(self.follow_up_messages) > 0


class ClinicContext:
    """Represents a clinic context template."""
    
    def __init__(self, context_id: str, data: Dict[str, Any]):
        self.context_id = context_id
        self.name = data["name"]
        self.description = data["description"]
        self.clinic_info_settings = data.get("clinic_info_settings", {})
        self.chat_settings = data.get("chat_settings", {})
    
    def create_clinic(self) -> Clinic:
        """Create a Clinic object from this context."""
        # Create clinic info settings
        clinic_info = ClinicInfoSettings(
            display_name=self.clinic_info_settings.get("display_name"),
            address=self.clinic_info_settings.get("address"),
            phone_number=self.clinic_info_settings.get("phone_number"),
            appointment_type_instructions=self.clinic_info_settings.get("appointment_type_instructions"),
            require_birthday=False
        )
        
        # Create chat settings
        chat_settings = ChatSettings(
            chat_enabled=self.chat_settings.get("chat_enabled", True),
            clinic_description=self.chat_settings.get("clinic_description"),
            therapist_info=self.chat_settings.get("therapist_info"),
            treatment_details=self.chat_settings.get("treatment_details"),
            service_item_selection_guide=self.chat_settings.get("service_item_selection_guide"),
            operating_hours=self.chat_settings.get("operating_hours"),
            location_details=self.chat_settings.get("location_details"),
            booking_policy=self.chat_settings.get("booking_policy"),
            payment_methods=self.chat_settings.get("payment_methods"),
            equipment_facilities=self.chat_settings.get("equipment_facilities"),
            common_questions=self.chat_settings.get("common_questions"),
            other_info=self.chat_settings.get("other_info"),
            ai_guidance=self.chat_settings.get("ai_guidance")
        )
        
        # Create full clinic settings
        from models.clinic import NotificationSettings, BookingRestrictionSettings
        clinic_settings = ClinicSettings(
            notification_settings=NotificationSettings(),
            booking_restriction_settings=BookingRestrictionSettings(),
            clinic_info_settings=clinic_info,
            chat_settings=chat_settings
        )
        
        # Create clinic object (minimal fields for testing)
        clinic = Clinic(
            id=1,  # Dummy ID for testing
            name=self.name,
            line_channel_id=f"test_channel_{self.context_id}",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            subscription_status="active",
            settings=clinic_settings.model_dump()
        )
        
        return clinic


class EvaluationRunner:
    """Main evaluation runner."""
    
    def __init__(self, test_cases_path: Optional[Path] = None, clinic_contexts_path: Optional[Path] = None):
        """Initialize the evaluation runner.
        
        Args:
            test_cases_path: Path to test_cases.yaml (default: eval_suite/test_cases.yaml)
            clinic_contexts_path: Path to clinic_contexts.yaml (default: eval_suite/clinic_contexts.yaml)
        """
        self.eval_suite_dir = Path(__file__).parent
        self.test_cases_path = test_cases_path or self.eval_suite_dir / "test_cases.yaml"
        self.clinic_contexts_path = clinic_contexts_path or self.eval_suite_dir / "clinic_contexts.yaml"
        
        self.test_cases: List[TestCase] = []
        self.clinic_contexts: Dict[str, ClinicContext] = {}
        
    def load_test_cases(self):
        """Load test cases from YAML file."""
        with open(self.test_cases_path, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
        
        self.test_cases = [TestCase(tc) for tc in data["test_cases"]]
        logger.info(f"Loaded {len(self.test_cases)} test cases")
    
    def load_clinic_contexts(self):
        """Load clinic contexts from YAML file."""
        with open(self.clinic_contexts_path, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
        
        self.clinic_contexts = {
            context_id: ClinicContext(context_id, context_data)
            for context_id, context_data in data["clinic_contexts"].items()
        }
        logger.info(f"Loaded {len(self.clinic_contexts)} clinic contexts")
    
    
    async def run_single_test(
        self,
        test_case: TestCase,
        clinic_context_id_override: Optional[str] = None
    ) -> Dict[str, Any]:
        """Run a single test case.
        
        Args:
            test_case: Test case to run
            clinic_context_id_override: Optional clinic context ID override (uses test case's context if None)
            
        Returns:
            Test result dictionary
        """
        # Determine clinic context - use override if provided, otherwise use test case's specified context
        if clinic_context_id_override:
            clinic_context_id = clinic_context_id_override
        else:
            clinic_context_id = test_case.clinic_context_id
        
        if clinic_context_id not in self.clinic_contexts:
            raise ValueError(f"Clinic context '{clinic_context_id}' not found for test case {test_case.test_id}")
        
        clinic_context = self.clinic_contexts[clinic_context_id]
        clinic = clinic_context.create_clinic()
        
        # Generate unique session ID for this test
        session_id = f"test-eval-{test_case.test_id}-{uuid.uuid4().hex[:8]}"
        
        # Get user message(s)
        if isinstance(test_case.user_message, list):
            user_messages = test_case.user_message
        else:
            user_messages = [test_case.user_message]
        
        # Add follow-up messages if any
        if test_case.follow_up_messages:
            user_messages.extend(test_case.follow_up_messages)
        
        # Run conversation
        responses = []
        for i, message in enumerate(user_messages):
            try:
                response = await ClinicAgentService.process_message(
                    session_id=session_id,
                    message=message,
                    clinic=clinic,
                    chat_settings_override=clinic.get_validated_settings().chat_settings
                )
                responses.append({
                    "turn": i + 1,
                    "user_message": message,
                    "chatbot_response": response
                })
            except Exception as e:
                logger.exception(f"Error processing message in test {test_case.test_id}: {e}")
                responses.append({
                    "turn": i + 1,
                    "user_message": message,
                    "chatbot_response": f"ERROR: {str(e)}",
                    "error": True
                })
        
        # Build result
        result = {
            "test_id": test_case.test_id,
            "category": test_case.category,
            "priority": test_case.priority,
            "description": test_case.description,
            "clinic_context_id": clinic_context_id,
            "clinic_name": clinic_context.name,
            "clinic_context": {
                "name": clinic_context.name,
                "description": clinic_context.description,
                "clinic_info_settings": clinic_context.clinic_info_settings,
                "chat_settings": clinic_context.chat_settings
            },
            "user_messages": user_messages,
            "responses": responses,
            "expected_behaviors": test_case.expected_behaviors,
            "evaluation_criteria": test_case.evaluation_criteria,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        return result
    
    async def run_all_tests(
        self,
        category: Optional[str] = None,
        test_id: Optional[str] = None,
        clinic_context_id: Optional[str] = None,
        max_concurrent: int = 5
    ) -> List[Dict[str, Any]]:
        """Run all or filtered test cases in parallel.
        
        Args:
            category: Filter by category (optional)
            test_id: Run specific test case (optional)
            clinic_context_id: Use specific clinic context for all tests (optional)
            max_concurrent: Maximum number of concurrent test executions (default: 5)
            
        Returns:
            List of test results
        """
        # Load data
        self.load_test_cases()
        self.load_clinic_contexts()
        
        # Filter test cases
        test_cases_to_run = self.test_cases
        if test_id:
            test_cases_to_run = [tc for tc in test_cases_to_run if tc.test_id == test_id]
        elif category:
            test_cases_to_run = [tc for tc in test_cases_to_run if tc.category == category]
        
        logger.info(f"Running {len(test_cases_to_run)} test case(s) with max {max_concurrent} concurrent")
        
        # Create semaphore to limit concurrency
        semaphore = asyncio.Semaphore(max_concurrent)
        
        async def run_test_with_semaphore(test_case: TestCase) -> Dict[str, Any]:
            """Run a single test with semaphore control."""
            async with semaphore:
                logger.info(f"Running test case: {test_case.test_id} - {test_case.description}")
                try:
                    result = await self.run_single_test(
                        test_case,
                        clinic_context_id_override=clinic_context_id
                    )
                    logger.info(f"Completed test case: {test_case.test_id}")
                    return result
                except Exception as e:
                    logger.exception(f"Error running test case {test_case.test_id}: {e}")
                    return {
                        "test_id": test_case.test_id,
                        "error": str(e),
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    }
        
        # Run all tests in parallel
        tasks = [run_test_with_semaphore(tc) for tc in test_cases_to_run]
        results = await asyncio.gather(*tasks, return_exceptions=False)
        
        return results
    
    def save_results(self, results: List[Dict[str, Any]], output_path: Path):
        """Save test results to JSON file.
        
        Args:
            results: List of test results
            output_path: Path to save JSON file
        """
        output_data = {
            "metadata": {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "total_tests": len(results),
                "evaluator_version": "1.0.0"
            },
            "results": results
        }
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)
        
        logger.info(f"Saved results to {output_path}")


async def main():
    """Main entry point for CLI usage."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Run chatbot evaluation suite")
    parser.add_argument(
        "--all",
        action="store_true",
        help="Run all test cases"
    )
    parser.add_argument(
        "--category",
        type=str,
        help="Run test cases in specific category"
    )
    parser.add_argument(
        "--test-case",
        type=str,
        help="Run specific test case by ID (e.g., TC-001)"
    )
    parser.add_argument(
        "--clinic-context",
        type=str,
        help="Use specific clinic context for all tests"
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="eval_outputs",
        help="Output directory for results and reports (default: eval_outputs)"
    )
    parser.add_argument(
        "--max-concurrent",
        type=int,
        default=5,
        help="Maximum number of concurrent test executions (default: 5)"
    )
    parser.add_argument(
        "--llm-eval",
        action="store_true",
        help="Run LLM evaluation on results (Workflow 2)"
    )
    
    args = parser.parse_args()
    
    # Setup logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Create output directory
    output_dir = Path(args.output_dir)
    output_dir.mkdir(exist_ok=True)
    
    # Create runner
    runner = EvaluationRunner()
    
    # Run tests
    if args.all or (not args.category and not args.test_case):
        results = await runner.run_all_tests(
            clinic_context_id=args.clinic_context,
            max_concurrent=args.max_concurrent
        )
    elif args.test_case:
        results = await runner.run_all_tests(
            test_id=args.test_case,
            clinic_context_id=args.clinic_context,
            max_concurrent=args.max_concurrent
        )
    elif args.category:
        results = await runner.run_all_tests(
            category=args.category,
            clinic_context_id=args.clinic_context,
            max_concurrent=args.max_concurrent
        )
    else:
        results = await runner.run_all_tests(
            clinic_context_id=args.clinic_context,
            max_concurrent=args.max_concurrent
        )
    
    # Generate timestamp for filenames
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    
    # Save results
    results_path = output_dir / f"results_{timestamp}.json"
    runner.save_results(results, results_path)
    
    # Run LLM evaluation if requested
    evaluations_path = None
    if args.llm_eval:
        # Import here to avoid circular dependencies
        import sys
        eval_suite_dir = Path(__file__).parent
        if str(eval_suite_dir) not in sys.path:
            sys.path.insert(0, str(eval_suite_dir))
        
        from llm_evaluator import LLMEvaluator
        logger.info("Running LLM evaluation...")
        llm_evaluator = LLMEvaluator()
        # Use same concurrency limit for LLM evaluation
        evaluations = await llm_evaluator.evaluate_all(results, max_concurrent=args.max_concurrent)
        evaluations_path = output_dir / f"evaluations_{timestamp}.json"
        llm_evaluator.save_evaluations(evaluations, evaluations_path)
        logger.info(f"LLM evaluation complete. Saved to {evaluations_path}")
    
    # Always generate reports
    import sys
    eval_suite_dir = Path(__file__).parent
    if str(eval_suite_dir) not in sys.path:
        sys.path.insert(0, str(eval_suite_dir))
    
    from report_generator import ReportGenerator
    report_prefix = output_dir / f"report_{timestamp}"
    generator = ReportGenerator(results_path, evaluations_path)
    generator.save_reports(str(report_prefix))
    
    print(f"\n✅ Evaluation complete! Ran {len(results)} test case(s).")
    print(f"📄 Results saved to: {results_path}")
    if evaluations_path:
        print(f"📊 LLM evaluations saved to: {evaluations_path}")
    print(f"📋 Reports saved to: {report_prefix}.md and {report_prefix}.json")


if __name__ == "__main__":
    asyncio.run(main())

