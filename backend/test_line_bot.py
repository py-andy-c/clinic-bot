#!/usr/bin/env python3
"""
Test script for LINE Bot conversation flow.

This script simulates LINE webhook messages to test the agent workflow
without needing a real LINE Official Account.
"""

import asyncio
import json
from typing import Optional
import os

# Set environment variables for testing
os.environ["DATABASE_URL"] = "sqlite:///./test.db"
os.environ["OPENAI_API_KEY"] = "your_openai_key_here"  # Replace with your key
os.environ["LINE_CHANNEL_SECRET"] = "test_secret"
os.environ["LINE_CHANNEL_ACCESS_TOKEN"] = "test_token"
os.environ["API_BASE_URL"] = "http://localhost:8000"

# Add src to path
import sys
sys.path.insert(0, 'src')

from agents.orchestrator import handle_line_message
from core.database import get_db
from models import Clinic

async def test_conversation():
    """Test the complete LINE bot conversation flow."""
    
    # Get database session
    db = next(get_db())
    
    # Create test clinic (if not exists)
    clinic = db.query(Clinic).first()
    if not clinic:
        clinic = Clinic(
            name='測試診所',
            line_channel_id='test_channel',
            line_channel_secret='test_secret',
            line_channel_access_token='test_token'
        )
        db.add(clinic)
        db.commit()
        db.refresh(clinic)
        print(f"✅ Created test clinic: {clinic.name}")
    
    # Test messages
    test_scenarios = [
        {
            "user": "test_user_1",
            "messages": [
                "我想預約治療",  # I want to book an appointment
                "0912345678",    # Phone number for account linking
                "王大明",         # Therapist name
                "2024-01-20 14:00",  # Date and time
                "初診評估"         # Appointment type
            ]
        }
    ]
    
    for scenario in test_scenarios:
        line_user_id = scenario["user"]
        print(f"\n🧪 Testing conversation for user: {line_user_id}")
        
        for i, message in enumerate(scenario["messages"]):
            print(f"\n📨 Message {i+1}: '{message}'")
            
            try:
                # Process the message
                response = await handle_line_message(
                    db=db,
                    clinic=clinic,
                    line_user_id=line_user_id,
                    message_text=message
                )
                
                if response:
                    print(f"🤖 Bot Response: '{response}'")
                else:
                    print("🤖 Bot Response: (no response - non-appointment query)")
                    
            except Exception as e:
                print(f"❌ Error processing message: {e}")
                import traceback
                traceback.print_exc()
    
    print("\n🎉 Conversation testing completed!")

if __name__ == "__main__":
    asyncio.run(test_conversation())
