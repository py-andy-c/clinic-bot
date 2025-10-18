#!/usr/bin/env python3
"""
Simple local test for the LINE bot agent workflow.

This script verifies that all agents can be imported and instantiated.
"""

import asyncio
import os
import sys

# Add src to path
sys.path.insert(0, 'src')

print("🤖 Testing LINE Bot Agent Imports")
print("=" * 40)

# Test basic agent imports without database models
try:
    from agents import Agent, Runner, RunConfig, trace
    print("✅ OpenAI Agents package imported successfully")
except ImportError as e:
    print(f"❌ Failed to import OpenAI agents: {e}")
    sys.exit(1)

try:
    from clinic_agents.triage_agent import triage_agent
    print("✅ Triage agent imported successfully")
except ImportError as e:
    print(f"❌ Failed to import triage agent: {e}")
    sys.exit(1)

try:
    from clinic_agents.account_linking_agent import account_linking_agent
    print("✅ Account linking agent imported successfully")
except ImportError as e:
    print(f"❌ Failed to import account linking agent: {e}")
    sys.exit(1)

try:
    from clinic_agents.appointment_agent import appointment_agent
    print("✅ Appointment agent imported successfully")
except ImportError as e:
    print(f"❌ Failed to import appointment agent: {e}")
    sys.exit(1)

print("\n🎉 All agent imports successful!")
print("\n💡 Next steps:")
print("1. Run the full test suite: cd /Users/andy/clinic-bot && ./run_tests.sh")
print("2. Add your OpenAI API key to backend/.env")
print("3. Test with real LINE: uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload")
