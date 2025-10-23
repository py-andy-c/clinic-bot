"""
Conversation quality guardrails service.

This module provides safety checks and quality monitoring for LLM conversations,
including content filtering, rate limiting, and quality scoring.
"""

import logging
import re
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)


class GuardrailsService:
    """
    Service for monitoring and enforcing conversation quality guardrails.

    This service provides multiple layers of protection:
    - Content filtering for inappropriate content
    - Rate limiting to prevent abuse
    - Quality scoring for conversation monitoring
    - Emergency keywords detection
    """

    def __init__(self):
        # Content filtering patterns - removed \b boundaries since they don't work well with Chinese
        self.inappropriate_patterns = [
            r'(暴力|violence|殺|kill|自殺|suicide)',
            r'(毒品|drugs|毒|poison)',
            r'(非法|illegal|犯罪|crime)',
            r'(歧視|discrimination|racial|hate)',
        ]

        # Emergency keywords that should trigger special handling
        self.emergency_keywords = [
            '緊急', 'emergency', '急診', '急救',
            '自殺', 'suicide', '自傷', 'self-harm',
            '暴力', 'violence', '威脅', 'threat',
            '醫療緊急', 'medical emergency'
        ]

        # Rate limiting storage (in production, use Redis)
        self.rate_limits: Dict[str, Any] = {}

    def check_content_safety(self, message: str) -> Tuple[bool, Optional[str]]:
        """
        Check if message content is safe and appropriate.

        Args:
            message: The message text to check

        Returns:
            Tuple of (is_safe, reason_if_unsafe)
        """
        message_lower = message.lower()

        # Check for inappropriate content
        for pattern in self.inappropriate_patterns:
            if re.search(pattern, message_lower, re.IGNORECASE):
                return False, f"檢測到不適當內容: {pattern}"

        # Check for emergency keywords
        for keyword in self.emergency_keywords:
            if keyword.lower() in message_lower:
                logger.warning(f"Emergency keyword detected: {keyword} in message: {message[:100]}...")
                # Don't block emergency messages, but log them
                break

        return True, None

    def check_rate_limit(self, user_id: str, max_requests: int = 10, window_minutes: int = 1) -> Tuple[bool, Optional[str]]:
        """
        Check if user is within rate limits.

        Args:
            user_id: Unique user identifier
            max_requests: Maximum requests allowed in the time window
            window_minutes: Time window in minutes

        Returns:
            Tuple of (is_allowed, reason_if_blocked)
        """
        now = datetime.now(timezone.utc)
        window_start = now - timedelta(minutes=window_minutes)

        # Get user's request history
        user_requests = self.rate_limits.get(user_id, [])

        # Remove old requests outside the window
        user_requests = [req for req in user_requests if req > window_start]

        # Check if user is over the limit
        if len(user_requests) >= max_requests:
            return False, f"請求過於頻繁，請稍後再試 (限制: {max_requests}次/{window_minutes}分鐘)"

        # Add current request
        user_requests.append(now)
        self.rate_limits[user_id] = user_requests

        return True, None

    def assess_conversation_quality(self, conversation_history: List[Dict[str, str]]) -> Dict[str, Any]:
        """
        Assess the quality of a conversation for monitoring purposes.

        Args:
            conversation_history: List of conversation messages

        Returns:
            Quality assessment metrics
        """
        if not conversation_history:
            return {"score": 0, "issues": ["Empty conversation"]}

        total_messages = len(conversation_history)
        user_messages = [msg for msg in conversation_history if msg.get("role") == "user"]
        assistant_messages = [msg for msg in conversation_history if msg.get("role") == "assistant"]

        # Basic quality metrics
        issues: List[str] = []
        metrics = {
            "total_messages": total_messages,
            "user_messages": len(user_messages),
            "assistant_messages": len(assistant_messages),
            "avg_user_message_length": sum(len(msg.get("content", "")) for msg in user_messages) / max(len(user_messages), 1),
            "avg_assistant_message_length": sum(len(msg.get("content", "")) for msg in assistant_messages) / max(len(assistant_messages), 1),
        }

        # Quality score (0-100)
        score = 100

        # Short conversation
        if total_messages < 3:
            score -= 20
            issues.append("Conversation too short")

        # Very long user messages (might indicate confusion)
        if any(len(msg.get("content", "")) > 1000 for msg in user_messages):
            score -= 10
            issues.append("Very long user messages")

        # Repetitive responses
        assistant_contents = [msg.get("content", "") for msg in assistant_messages]
        if len(set(assistant_contents)) < len(assistant_contents) * 0.5:
            score -= 15
            issues.append("Repetitive assistant responses")

        # No appointment-related content
        all_content = " ".join([msg.get("content", "") for msg in conversation_history])
        appointment_keywords = ['預約', '預約', '時間', '治療師', '醫生', 'appointment', 'booking']
        has_appointment_content = any(keyword in all_content.lower() for keyword in appointment_keywords)

        if not has_appointment_content and total_messages > 2:
            score -= 25
            issues.append("No appointment-related content")

        return {
            **metrics,
            "score": max(0, min(100, score)),
            "issues": issues
        }

    def should_escalate_conversation(self, conversation_history: List[Dict[str, str]]) -> Tuple[bool, Optional[str]]:
        """
        Determine if a conversation should be escalated for human review.

        Args:
            conversation_history: Full conversation history

        Returns:
            Tuple of (should_escalate, reason)
        """
        quality = self.assess_conversation_quality(conversation_history)

        # Escalate if quality score is very low
        if quality["score"] < 30:
            return True, f"Low quality score: {quality['score']}"

        # Escalate if too many issues
        if len(quality["issues"]) >= 3:
            return True, f"Multiple quality issues: {', '.join(quality['issues'])}"

        # Escalate if conversation is very long but unproductive
        if quality["total_messages"] > 20 and quality["score"] < 50:
            return True, "Long conversation with low productivity"

        return False, None

    def log_conversation_metrics(self, conversation_id: str, metrics: Dict[str, Any]) -> None:
        """
        Log conversation metrics for monitoring and analytics.

        Args:
            conversation_id: Unique conversation identifier
            metrics: Quality metrics to log
        """
        logger.info(
            f"Conversation {conversation_id} metrics: "
            f"Score={metrics['score']}, "
            f"Messages={metrics['total_messages']}, "
            f"Issues={len(metrics['issues'])}"
        )

        if metrics["issues"]:
            logger.warning(f"Conversation {conversation_id} issues: {', '.join(metrics['issues'])}")


# Global guardrails service instance
_guardrails_service: Optional[GuardrailsService] = None


def get_guardrails_service() -> GuardrailsService:
    """
    Get the global guardrails service instance.

    Returns:
        The global guardrails service instance
    """
    global _guardrails_service
    if _guardrails_service is None:
        _guardrails_service = GuardrailsService()
    return _guardrails_service
