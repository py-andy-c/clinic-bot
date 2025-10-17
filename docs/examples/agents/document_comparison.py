from pydantic import BaseModel
from agents import Agent, ModelSettings, TResponseInputItem, Runner, RunConfig, trace
from openai.types.shared.reasoning import Reasoning

class TriageRequestSchema(BaseModel):
  classification: str


class ApprovalAgentSchema(BaseModel):
  emailFrom: str
  defaultTo: str
  defaultSubject: str
  defaultBody: str


triage_request = Agent(
  name="Triage request",
  instructions="""Classify the user's request based on whether two documents have been provided recently in the conversation, and whether the user is asking a particular question.

If two documents are provided and there's no user question , respond with \"compare\".
If two documents are provided and there is a user question , respond with \"answer_question\".
If only one doc has been provided, or no docs have been provided, respond with \"request_upload\"""",
  model="gpt-4.1",
  output_type=TriageRequestSchema,
  model_settings=ModelSettings(
    temperature=1,
    top_p=1,
    max_tokens=2048,
    store=True
  )
)


propose_reconciliation = Agent(
  name="Propose reconciliation",
  instructions="Given the differences between the two documents, assemble a single option for how to reconcile the difference. If no order has been described, consider the first document the user's version and the second document the potential set of changes returned back to the user. The proposal you create will be sent to the user for approval.",
  model="gpt-5",
  model_settings=ModelSettings(
    store=True,
    reasoning=Reasoning(
      effort="minimal",
      summary="auto"
    )
  )
)


approval_agent = Agent(
  name="Approval agent",
  instructions="""Explain your approval reasoning. Help the user draft a proper response by filling out this data schema:

{
  emailFrom: 'user@test.com',
  defaultTo: 'user@test.com',
  defaultSubject: 'Document comparison proposal',
  defaultBody: \"Hey there, \n\nHope you're doing well! Just wanted to check in and see if there are any updates on the ChatKit roadmap. We're excited to see what's coming next and how we can make the most of the upcoming features.\n\nEspecially curious to see how you support widgets!\n\nBest,\",
}""",
  model="gpt-5-mini",
  output_type=ApprovalAgentSchema,
  model_settings=ModelSettings(
    store=True,
    reasoning=Reasoning(
      effort="low",
      summary="auto"
    )
  )
)


rejection_agent = Agent(
  name="Rejection agent",
  instructions="Explain your rejection reasoning.",
  model="gpt-5",
  model_settings=ModelSettings(
    store=True,
    reasoning=Reasoning(
      effort="low",
      summary="auto"
    )
  )
)


retry_agent = Agent(
  name="Retry agent",
  instructions="The user has not uploaded the required two documents for comparison. Suggest that they upload a total of two documents, using the paperclip icon.",
  model="gpt-5-nano",
  model_settings=ModelSettings(
    store=True,
    reasoning=Reasoning(
      effort="minimal",
      summary="auto"
    )
  )
)


provide_explanation = Agent(
  name="Provide explanation",
  instructions="Use the information in the uploaded documents to answer the user's question.",
  model="gpt-5-nano",
  model_settings=ModelSettings(
    store=True,
    reasoning=Reasoning(
      effort="minimal",
      summary="auto"
    )
  )
)


def approval_request(message: str):
  # TODO: Implement
  return True

class WorkflowInput(BaseModel):
  input_as_text: str


# Main code entrypoint
async def run_workflow(workflow_input: WorkflowInput):
  with trace("Agent builder workflow"):
    state = {

    }
    workflow = workflow_input.model_dump()
    conversation_history: list[TResponseInputItem] = [
      {
        "role": "user",
        "content": [
          {
            "type": "input_text",
            "text": workflow["input_as_text"]
          }
        ]
      }
    ]
    triage_request_result_temp = await Runner.run(
      triage_request,
      input=[
        *conversation_history
      ],
      run_config=RunConfig(trace_metadata={
        "__trace_source__": "agent-builder"
      })
    )

    conversation_history.extend([item.to_input_item() for item in triage_request_result_temp.new_items])

    triage_request_result = {
      "output_text": triage_request_result_temp.final_output.json(),
      "output_parsed": triage_request_result_temp.final_output.model_dump()
    }
    if triage_request_result["output_parsed"]["classification"] == "compare":
      propose_reconciliation_result_temp = await Runner.run(
        propose_reconciliation,
        input=[
          *conversation_history
        ],
        run_config=RunConfig(trace_metadata={
          "__trace_source__": "agent-builder"
        })
      )

      conversation_history.extend([item.to_input_item() for item in propose_reconciliation_result_temp.new_items])

      propose_reconciliation_result = {
        "output_text": propose_reconciliation_result_temp.final_output_as(str)
      }
      approval_message = f"Please review the proposal {propose_reconciliation_result["output_text"]}"

      if approval_request(approval_message):
          approval_agent_result_temp = await Runner.run(
            approval_agent,
            input=[
              *conversation_history
            ],
            run_config=RunConfig(trace_metadata={
              "__trace_source__": "agent-builder"
            })
          )

          conversation_history.extend([item.to_input_item() for item in approval_agent_result_temp.new_items])

          approval_agent_result = {
            "output_text": approval_agent_result_temp.final_output.json(),
            "output_parsed": approval_agent_result_temp.final_output.model_dump()
          }
      else:
          rejection_agent_result_temp = await Runner.run(
            rejection_agent,
            input=[
              *conversation_history
            ],
            run_config=RunConfig(trace_metadata={
              "__trace_source__": "agent-builder"
            })
          )

          conversation_history.extend([item.to_input_item() for item in rejection_agent_result_temp.new_items])

          rejection_agent_result = {
            "output_text": rejection_agent_result_temp.final_output_as(str)
          }
    elif triage_request_result["output_parsed"]["classification"] == "answer_question":
      provide_explanation_result_temp = await Runner.run(
        provide_explanation,
        input=[
          *conversation_history
        ],
        run_config=RunConfig(trace_metadata={
          "__trace_source__": "agent-builder"
        })
      )

      conversation_history.extend([item.to_input_item() for item in provide_explanation_result_temp.new_items])

      provide_explanation_result = {
        "output_text": provide_explanation_result_temp.final_output_as(str)
      }
    else:
      retry_agent_result_temp = await Runner.run(
        retry_agent,
        input=[
          *conversation_history
        ],
        run_config=RunConfig(trace_metadata={
          "__trace_source__": "agent-builder"
        })
      )

      conversation_history.extend([item.to_input_item() for item in retry_agent_result_temp.new_items])

      retry_agent_result = {
        "output_text": retry_agent_result_temp.final_output_as(str)
      }
