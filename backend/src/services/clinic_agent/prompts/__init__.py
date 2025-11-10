"""
Prompts module for clinic agent system prompts.

This module contains the system prompts used by the clinic agent service
to configure the AI assistant's behavior and knowledge base.

Modules:
    base_system_prompt: Main system prompt template with clinic-specific instructions
    appointment_system_guide: Guide for the appointment system accessible via LINE menu
"""

from .base_system_prompt import BASE_SYSTEM_PROMPT
from .appointment_system_guide import APPOINTMENT_SYSTEM_GUIDE

__all__ = ['BASE_SYSTEM_PROMPT', 'APPOINTMENT_SYSTEM_GUIDE']

