# Chatbot Evaluation Suite

A systematic evaluation suite for testing and improving the clinic chatbot across diverse scenarios and clinic contexts.

## Overview

This evaluation suite provides:
- **~20 diverse test cases** covering different scenarios (clinic information, health consultation, safety boundaries, etc.)
- **Multiple clinic context templates** (minimal, comprehensive, with AI guidance, etc.)
- **LLM-based evaluation** that considers guidelines from `base_system_prompt.py`
- **Automatic report generation** (both Markdown and JSON formats)
- **Parallel execution** for faster test runs

## Workflows

### Workflow 1: Run Tests and Generate Reports

Run tests and generate reports without LLM evaluation:

```bash
cd backend
python -m eval_suite.evaluator --all
```

This will:
1. Run all test cases
2. Generate reports (Markdown + JSON)
3. Save outputs to `eval_outputs/` directory

### Workflow 2: Run Tests + LLM Evaluation + Generate Reports

Run tests, evaluate with LLM, and generate reports with LLM feedback:

```bash
cd backend
python -m eval_suite.evaluator --all --llm-eval
```

This will:
1. Run all test cases
2. Evaluate responses using LLM (considers `base_system_prompt.py` guidelines)
3. Generate reports with LLM evaluation feedback (Markdown + JSON)
4. Save outputs to `eval_outputs/` directory

## Quick Start

### Run All Tests (Workflow 1)
```bash
python -m eval_suite.evaluator --all
```

### Run All Tests with LLM Evaluation (Workflow 2)
```bash
python -m eval_suite.evaluator --all --llm-eval
```

### Run Specific Category
```bash
python -m eval_suite.evaluator --category clinic_information
```

### Run Specific Test Case
```bash
python -m eval_suite.evaluator --test-case TC-001
```

### Run with Custom Concurrency
```bash
# Faster execution (uses more API quota)
python -m eval_suite.evaluator --all --max-concurrent 10

# More conservative
python -m eval_suite.evaluator --all --max-concurrent 3
```

### Custom Output Directory
```bash
python -m eval_suite.evaluator --all --output-dir my_eval_results
```

## Output Files

All outputs are saved to the `eval_outputs/` directory (or custom directory if specified):

- `results_YYYYMMDD_HHMMSS.json` - Raw test results with chatbot responses
- `evaluations_YYYYMMDD_HHMMSS.json` - LLM evaluations (only if `--llm-eval` is used)
- `report_YYYYMMDD_HHMMSS.md` - Human-readable Markdown report
- `report_YYYYMMDD_HHMMSS.json` - Machine-readable JSON report

The reports include:
- Summary statistics
- Results by category
- Detailed test results with chatbot responses
- LLM evaluation scores and reasoning (if LLM eval was run)
- Guideline violations (if any)
- Recommendations for improvements

## Test Cases

Test cases are defined in `test_cases.yaml` and cover:

1. **Clinic Information** (TC-001 to TC-005)
   - Operating hours queries
   - Treatment details
   - Hallucination prevention

2. **Health Consultation** (TC-006 to TC-009)
   - Symptom inquiries
   - Safety boundaries (no diagnosis, no prescriptions)
   - Vague symptom handling

3. **Safety & Boundaries** (TC-010 to TC-012)
   - Privacy enforcement
   - Off-topic decline
   - Appointment limitations

4. **Knowledge Priority** (TC-013 to TC-014)
   - Unique philosophy adherence
   - Safety warning priority

5. **AI Guidance** (TC-015 to TC-017)
   - Custom greetings
   - Promotion timing
   - Core principle override protection

6. **Formatting** (TC-018 to TC-019)
   - Response formatting
   - Question placement

7. **Multi-Turn** (TC-020)
   - Conversation continuity

## Clinic Contexts

Clinic contexts are defined in `clinic_contexts.yaml`:

- **minimal**: Basic clinic info only
- **comprehensive**: Full clinic context with all fields
- **with_ai_guidance**: Clinic with custom AI guidance
- **unique_philosophy**: Clinic with unique treatment philosophy
- **with_contraindication**: Clinic with safety warnings
- **unsafe_guidance**: Clinic with unsafe AI guidance (to test override protection)

## LLM Evaluation

The LLM evaluator uses guidelines from `base_system_prompt.py` to ensure evaluations align with the chatbot's intended behavior. It evaluates responses on:

1. **Grounded in Context** (1-5): Response is based on clinic context, no hallucinations
2. **Safety Boundaries** (Pass/Fail): No diagnosis, no prescriptions, proper disclaimers
3. **Correctness** (1-5): Information accuracy
4. **Tone & Appropriateness** (1-5): Professional, empathetic, appropriate tone
5. **Helpfulness** (1-5): Provides value to user
6. **Formatting & Readability** (1-5): Proper formatting, easy to read
7. **Conversation Continuity** (1-5): Maintains context across turns (multi-turn only)

The evaluator provides:
- Scores for each criterion
- Detailed reasoning for each score
- List of any guideline violations
- Overall notes and recommendations

## File Structure

```
eval_suite/
├── __init__.py
├── test_cases.yaml          # Test case definitions
├── clinic_contexts.yaml     # Clinic context templates
├── evaluator.py             # Main evaluation runner
├── llm_evaluator.py         # LLM-based evaluation
├── report_generator.py       # Report generation
└── README.md                # This file
```

## Configuration

The LLM evaluator uses the `OPENAI_API_KEY` environment variable (from `backend/.env`). It defaults to using `gpt-4o-mini` for cost-effective evaluation.

## See Also

- Design document: `docs/design_doc/eval_suite.md`
- Chatbot service: `src/services/clinic_agent/service.py`
- Base system prompt: `src/services/clinic_agent/prompts/base_system_prompt.py`
