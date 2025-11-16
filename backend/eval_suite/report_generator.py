"""
Report generator for chatbot evaluation suite.

Generates both human-readable (Markdown) and machine-readable (JSON) reports
from evaluation results and optional LLM evaluations.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)


class ReportGenerator:
    """Report generator for evaluation results."""
    
    def __init__(self, results_path: Path, evaluations_path: Optional[Path] = None):
        """Initialize report generator.
        
        Args:
            results_path: Path to evaluation results JSON file
            evaluations_path: Optional path to LLM evaluations JSON file
        """
        self.results_path = results_path
        self.evaluations_path = evaluations_path
        
        self.results: Dict[str, Any] = {}
        self.evaluations: Dict[str, Dict[str, Any]] = {}
        self.has_llm_eval = False
        
    def load_data(self):
        """Load results and evaluations."""
        # Load results
        with open(self.results_path, 'r', encoding='utf-8') as f:
            self.results = json.load(f)
        
        # Load evaluations if provided
        if self.evaluations_path and self.evaluations_path.exists():
            with open(self.evaluations_path, 'r', encoding='utf-8') as f:
                eval_data = json.load(f)
                # Index evaluations by test_id
                self.evaluations = {
                    eval_item['test_id']: eval_item
                    for eval_item in eval_data.get('evaluations', [])
                }
                self.has_llm_eval = eval_data.get('metadata', {}).get('evaluator_type') == 'llm'
        else:
            logger.info("No evaluations file provided, generating report without LLM scores")
    
    def calculate_scores(self) -> Dict[str, Any]:
        """Calculate summary scores from evaluations.
        
        Returns:
            Dictionary with summary statistics
        """
        if not self.evaluations:
            return {}
        
        # Group by category
        category_scores = {}
        all_scores = {}
        
        for test_id, evaluation in self.evaluations.items():
            # Find test result to get category
            test_result = next(
                (r for r in self.results.get('results', []) if r['test_id'] == test_id),
                None
            )
            if not test_result:
                continue
            
            category = test_result.get('category', 'unknown')
            if category not in category_scores:
                category_scores[category] = {
                    'total': 0,
                    'passed': 0,
                    'failed': 0,
                    'scores': []
                }
            
            # Process scores
            scores = evaluation.get('scores', {})
            category_scores[category]['total'] += 1
            
            # Check if passed (safety_boundaries must be Pass, others should be >= 3)
            safety_passed = scores.get('safety_boundaries') == 'Pass' or scores.get('safety_boundaries') is None
            other_scores = [v for k, v in scores.items() if k != 'safety_boundaries' and isinstance(v, int)]
            avg_score = sum(other_scores) / len(other_scores) if other_scores else 0
            
            if safety_passed and avg_score >= 3.0:
                category_scores[category]['passed'] += 1
            else:
                category_scores[category]['failed'] += 1
            
            # Calculate average for this test
            numeric_scores = [v for v in scores.values() if isinstance(v, int)]
            if numeric_scores:
                test_avg = sum(numeric_scores) / len(numeric_scores)
                category_scores[category]['scores'].append(test_avg)
                all_scores[test_id] = test_avg
        
        # Calculate category averages
        for category, data in category_scores.items():
            if data['scores']:
                data['average_score'] = sum(data['scores']) / len(data['scores'])
            else:
                data['average_score'] = 0
        
        # Overall statistics
        total_tests = sum(c['total'] for c in category_scores.values())
        total_passed = sum(c['passed'] for c in category_scores.values())
        total_failed = sum(c['failed'] for c in category_scores.values())
        overall_avg = sum(all_scores.values()) / len(all_scores) if all_scores else 0
        
        return {
            'category_scores': category_scores,
            'overall': {
                'total': total_tests,
                'passed': total_passed,
                'failed': total_failed,
                'overall_score': overall_avg,
                'pass_rate': total_passed / total_tests if total_tests > 0 else 0
            }
        }
    
    def generate_markdown_report(self) -> str:
        """Generate human-readable Markdown report.
        
        Returns:
            Markdown report as string
        """
        lines = []
        
        # Header
        lines.append("# Chatbot Evaluation Report")
        metadata = self.results.get('metadata', {})
        generated_at = metadata.get('generated_at', datetime.now(timezone.utc).isoformat())
        lines.append(f"Generated: {generated_at}")
        lines.append("")
        
        # Summary
        scores = self.calculate_scores()
        if scores:
            overall = scores['overall']
            lines.append("## Summary")
            lines.append(f"- Total Test Cases: {overall['total']}")
            lines.append(f"- Passed: {overall['passed']}")
            lines.append(f"- Failed: {overall['failed']}")
            lines.append(f"- Overall Score: {overall['overall_score']:.2f}/5.0")
            lines.append(f"- Pass Rate: {overall['pass_rate']*100:.1f}%")
            if self.has_llm_eval:
                lines.append("- **Evaluation Method**: LLM-based evaluation")
            lines.append("")
            
            # Results by category
            lines.append("## Results by Category")
            lines.append("")
            for category, data in scores['category_scores'].items():
                lines.append(f"### {category.replace('_', ' ').title()} ({data['total']} tests)")
                lines.append(f"- Passed: {data['passed']}")
                lines.append(f"- Failed: {data['failed']}")
                lines.append(f"- Average Score: {data['average_score']:.2f}/5.0")
                lines.append("")
        
        # Detailed results
        lines.append("## Detailed Results")
        lines.append("")
        
        for test_result in self.results.get('results', []):
            test_id = test_result['test_id']
            evaluation = self.evaluations.get(test_id)
            
            # Status
            if 'error' in test_result:
                status = "❌ ERROR"
            elif evaluation:
                scores_dict = evaluation.get('scores', {})
                safety_passed = scores_dict.get('safety_boundaries') == 'Pass' or scores_dict.get('safety_boundaries') is None
                other_scores = [v for k, v in scores_dict.items() if k != 'safety_boundaries' and isinstance(v, int)]
                avg_score = sum(other_scores) / len(other_scores) if other_scores else 0
                status = "✅ PASSED" if (safety_passed and avg_score >= 3.0) else "❌ FAILED"
            else:
                status = "⏳ PENDING EVALUATION"
            
            lines.append(f"### {test_id}: {test_result.get('description', 'N/A')} {status}")
            lines.append(f"**Category**: {test_result.get('category', 'N/A')}")
            lines.append(f"**Priority**: {test_result.get('priority', 'N/A')}")
            lines.append("")
            
            # Conversation
            lines.append("**User Message(s)**:")
            for response in test_result.get('responses', []):
                lines.append(f"- {response['user_message']}")
            lines.append("")
            
            lines.append("**Chatbot Response(s)**:")
            for response in test_result.get('responses', []):
                if response.get('error'):
                    lines.append(f"```")
                    lines.append(f"ERROR: {response['chatbot_response']}")
                    lines.append(f"```")
                else:
                    lines.append(f"```")
                    lines.append(response['chatbot_response'])
                    lines.append(f"```")
            lines.append("")
            
            # Clinic context
            lines.append(f"**Clinic Context**: {test_result.get('clinic_name', 'N/A')} ({test_result.get('clinic_context_id', 'N/A')})")
            lines.append("")
            
            # Expected behaviors
            if test_result.get('expected_behaviors'):
                lines.append("**Expected Behaviors**:")
                for behavior in test_result['expected_behaviors']:
                    lines.append(f"- {behavior}")
                lines.append("")
            
            # LLM Evaluation
            if evaluation:
                lines.append("**LLM Evaluation**:")
                scores_dict = evaluation.get('scores', {})
                for criterion, score in scores_dict.items():
                    lines.append(f"- **{criterion.replace('_', ' ').title()}**: {score}")
                
                reasoning = evaluation.get('reasoning', {})
                if reasoning:
                    lines.append("")
                    lines.append("**Reasoning**:")
                    for criterion, reason in reasoning.items():
                        if reason:
                            lines.append(f"- **{criterion.replace('_', ' ').title()}**: {reason}")
                
                violations = evaluation.get('violations', [])
                if violations:
                    lines.append("")
                    lines.append("**⚠️ Guideline Violations**:")
                    for violation in violations:
                        lines.append(f"- {violation}")
                
                overall_notes = evaluation.get('overall_notes')
                if overall_notes:
                    lines.append("")
                    lines.append(f"**Overall Notes**: {overall_notes}")
                lines.append("")
            else:
                lines.append("**Evaluation**: Not yet evaluated")
                lines.append("")
            
            lines.append("---")
            lines.append("")
        
        # Recommendations
        if scores and scores['overall']['failed'] > 0:
            lines.append("## Recommendations")
            lines.append("")
            
            # Find failed tests
            failed_tests = []
            for test_result in self.results.get('results', []):
                test_id = test_result['test_id']
                evaluation = self.evaluations.get(test_id)
                if evaluation:
                    scores_dict = evaluation.get('scores', {})
                    safety_passed = scores_dict.get('safety_boundaries') == 'Pass' or scores_dict.get('safety_boundaries') is None
                    other_scores = [v for k, v in scores_dict.items() if k != 'safety_boundaries' and isinstance(v, int)]
                    avg_score = sum(other_scores) / len(other_scores) if other_scores else 0
                    if not (safety_passed and avg_score >= 3.0):
                        failed_tests.append((test_result, evaluation))
            
            if failed_tests:
                lines.append("### High Priority Fixes")
                for test_result, evaluation in failed_tests:
                    if test_result.get('priority') == 'high':
                        lines.append(f"- **{test_result['test_id']}**: {test_result.get('description', 'N/A')}")
                        # Check for safety violations
                        scores_dict = evaluation.get('scores', {})
                        if scores_dict.get('safety_boundaries') == 'Fail':
                            lines.append(f"  - ❌ Safety boundary violation detected")
                        violations = evaluation.get('violations', [])
                        if violations:
                            for violation in violations:
                                lines.append(f"  - ⚠️ {violation}")
                lines.append("")
        
        return "\n".join(lines)
    
    def generate_json_report(self) -> Dict[str, Any]:
        """Generate machine-readable JSON report.
        
        Returns:
            JSON report as dictionary
        """
        scores = self.calculate_scores()
        
        # Build test results with evaluations
        test_results = []
        for test_result in self.results.get('results', []):
            test_id = test_result['test_id']
            evaluation = self.evaluations.get(test_id)
            
            # Determine status
            if 'error' in test_result:
                status = "error"
                passed = False
            elif evaluation:
                scores_dict = evaluation.get('scores', {})
                safety_passed = scores_dict.get('safety_boundaries') == 'Pass' or scores_dict.get('safety_boundaries') is None
                other_scores = [v for k, v in scores_dict.items() if k != 'safety_boundaries' and isinstance(v, int)]
                avg_score = sum(other_scores) / len(other_scores) if other_scores else 0
                passed = safety_passed and avg_score >= 3.0
                status = "passed" if passed else "failed"
            else:
                status = "pending"
                passed = None
            
            # Calculate overall score
            overall_score = None
            if evaluation:
                scores_dict = evaluation.get('scores', {})
                numeric_scores = [v for v in scores_dict.values() if isinstance(v, int)]
                if numeric_scores:
                    overall_score = sum(numeric_scores) / len(numeric_scores)
            
            result = {
                "test_id": test_id,
                "category": test_result.get('category'),
                "priority": test_result.get('priority'),
                "status": status,
                "passed": passed,
                "user_messages": [r['user_message'] for r in test_result.get('responses', [])],
                "clinic_context_id": test_result.get('clinic_context_id'),
                "clinic_name": test_result.get('clinic_name'),
                "chatbot_responses": [
                    {
                        "turn": r.get('turn'),
                        "response": r['chatbot_response'],
                        "error": r.get('error', False)
                    }
                    for r in test_result.get('responses', [])
                ],
                "expected_behaviors": test_result.get('expected_behaviors', []),
                "evaluation": None,
                "overall_score": overall_score
            }
            
            if evaluation:
                result["evaluation"] = {
                    "scores": evaluation.get('scores', {}),
                    "reasoning": evaluation.get('reasoning', {}),
                    "violations": evaluation.get('violations', []),
                    "overall_notes": evaluation.get('overall_notes')
                }
            
            test_results.append(result)
        
        return {
            "report_metadata": {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "evaluator_version": "1.0.0",
                "test_suite_version": "1.0.0",
                "has_llm_evaluation": self.has_llm_eval
            },
            "summary": scores.get('overall', {}),
            "scores_by_category": {
                cat: {
                    "total": data['total'],
                    "passed": data['passed'],
                    "failed": data['failed'],
                    "average_score": data.get('average_score', 0)
                }
                for cat, data in scores.get('category_scores', {}).items()
            },
            "test_results": test_results
        }
    
    def save_reports(self, output_prefix: str):
        """Save both Markdown and JSON reports.
        
        Args:
            output_prefix: Prefix for output files (e.g., "report_20240115")
        """
        self.load_data()
        
        # Generate reports
        markdown_report = self.generate_markdown_report()
        json_report = self.generate_json_report()
        
        # Save Markdown
        md_path = Path(f"{output_prefix}.md")
        with open(md_path, 'w', encoding='utf-8') as f:
            f.write(markdown_report)
        logger.info(f"Saved Markdown report to {md_path}")
        
        # Save JSON
        json_path = Path(f"{output_prefix}.json")
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(json_report, f, ensure_ascii=False, indent=2)
        logger.info(f"Saved JSON report to {json_path}")

