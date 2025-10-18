#!/usr/bin/env python3
"""
Test LINE credentials from .env file.

This script verifies that your LINE Channel Access Token and Secret
are valid by making a test API call to LINE.
"""

import os
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, 'src')

def load_env_file():
    """Load environment variables from .env file."""
    env_file = Path('.env')
    if not env_file.exists():
        print("❌ .env file not found!")
        return False

    with open(env_file, 'r') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#'):
                if '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key] = value

    return True

def test_line_credentials():
    """Test LINE credentials by initializing the service."""
    print("🔍 Testing LINE Credentials")
    print("=" * 40)

    # Load credentials from .env
    if not load_env_file():
        return False

    # Get credentials
    channel_secret = os.getenv('LINE_CHANNEL_SECRET')
    access_token = os.getenv('LINE_CHANNEL_ACCESS_TOKEN')

    if not channel_secret or not access_token:
        print("❌ LINE credentials not found in .env file!")
        print("   Make sure you have:")
        print("   LINE_CHANNEL_SECRET=your_secret")
        print("   LINE_CHANNEL_ACCESS_TOKEN=your_token")
        return False

    # Mask credentials for display
    masked_secret = channel_secret[:8] + "..." + channel_secret[-4:] if len(channel_secret) > 12 else channel_secret
    masked_token = access_token[:10] + "..." + access_token[-4:] if len(access_token) > 14 else access_token

    print(f"📋 Channel Secret: {masked_secret}")
    print(f"🔑 Access Token: {masked_token}")
    print()

    try:
        # Import and test LINE service
        from services.line_service import LINEService

        print("🔗 Initializing LINE service...")
        line_service = LINEService(
            channel_secret=channel_secret,
            channel_access_token=access_token
        )

        print("📡 Testing LINE API connection...")
        # Try to get bot info (this will fail with invalid credentials)
        try:
            # This is a simple test - we'll try to access the API
            # If credentials are invalid, this will raise an exception
            bot_info = line_service.api.get_bot_info()
            print("✅ LINE credentials are VALID!")
            print(f"🤖 Bot Name: {bot_info.display_name}")
            # Handle different API versions
            if hasattr(bot_info, 'description'):
                print(f"📱 Bot Description: {bot_info.description or 'No description'}")
            else:
                print("📱 Bot Description: Not available in this API version")
            return True

        except Exception as e:
            error_msg = str(e)
            if "401" in error_msg or "invalid_token" in error_msg or "Authentication failed" in error_msg:
                print("❌ LINE credentials are INVALID!")
                print("   Error: Authentication failed")
                print("   This means your Channel Access Token is incorrect or expired.")
                return False
            else:
                print("❌ LINE API error (but credentials may be valid):")
                print(f"   Error: {error_msg}")
                return False

    except ImportError as e:
        print("❌ Failed to import LINE service:")
        print(f"   {e}")
        print("   Make sure you're in the backend directory and virtual environment is activated.")
        return False
    except Exception as e:
        print("❌ Unexpected error:")
        print(f"   {e}")
        return False

def main():
    """Main function."""
    print("🧪 LINE Credentials Test Tool")
    print("=" * 40)
    print()

    success = test_line_credentials()

    print()
    if success:
        print("🎉 SUCCESS: Your LINE credentials are working!")
        print("   Your LINE bot should be able to send and receive messages.")
    else:
        print("💥 FAILURE: Your LINE credentials need to be fixed.")
        print("   Please check:")
        print("   1. You have the correct Channel Secret and Access Token")
        print("   2. The tokens are from your LINE Official Account")
        print("   3. The tokens haven't expired")
        print("   4. You're using tokens from the correct environment (dev/prod)")

    print()
    print("🔗 Get new credentials from: https://developers.line.biz/console/")
    print("   Go to your Official Account → Messaging API → Channel access token")

    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())
