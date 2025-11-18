"""
Shared types for availability-related functionality.

This module contains shared data classes and types used across availability services
to ensure type safety and consistency.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class SlotData:
    """
    Represents an available time slot.
    
    Used across AvailabilityService and AvailabilityNotificationService
    to ensure consistent slot data structure.
    """
    start_time: str  # Format: "HH:MM" or "HH:MM:SS"
    end_time: str  # Format: "HH:MM" or "HH:MM:SS"
    practitioner_id: int
    practitioner_name: str
    is_recommended: Optional[bool] = None  # True if slot is recommended for compact scheduling
    
    def to_dict(self) -> dict[str, str | int | bool | None]:
        """Convert to dictionary format."""
        result: dict[str, str | int | bool | None] = {
            "start_time": self.start_time,
            "end_time": self.end_time,
            "practitioner_id": self.practitioner_id,
            "practitioner_name": self.practitioner_name,
        }
        if self.is_recommended is not None:
            result["is_recommended"] = self.is_recommended
        return result
    
    @classmethod
    def from_dict(cls, data: dict[str, str | int | bool | None]) -> "SlotData":
        """Create SlotData from dictionary."""
        is_recommended: Optional[bool] = None
        if "is_recommended" in data and isinstance(data["is_recommended"], bool):
            is_recommended = data["is_recommended"]
        
        # Ensure required fields are present and correct types
        start_time_val = data.get("start_time")
        end_time_val = data.get("end_time")
        practitioner_id_val = data.get("practitioner_id")
        practitioner_name_val = data.get("practitioner_name")
        
        if not isinstance(start_time_val, str):
            raise ValueError(f"start_time must be str, got {type(start_time_val)}")
        if not isinstance(end_time_val, str):
            raise ValueError(f"end_time must be str, got {type(end_time_val)}")
        if not isinstance(practitioner_id_val, int):
            raise ValueError(f"practitioner_id must be int, got {type(practitioner_id_val)}")
        if not isinstance(practitioner_name_val, str):
            raise ValueError(f"practitioner_name must be str, got {type(practitioner_name_val)}")
        
        return cls(
            start_time=start_time_val,
            end_time=end_time_val,
            practitioner_id=practitioner_id_val,
            practitioner_name=practitioner_name_val,
            is_recommended=is_recommended,
        )

