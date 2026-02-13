from typing import Any

class MissingType:
    """
    Type for the MISSING sentinel, representing an omitted optional parameter.
    
    This is used to distinguish between a parameter that was not provided (MISSING)
    and a parameter that was explicitly set to null (None).
    """
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(MissingType, cls).__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        return "MISSING"
    
    def __bool__(self) -> bool:
        return False

    def __eq__(self, other: object) -> bool:
        return isinstance(other, MissingType)
    
    def __hash__(self) -> int:
        return hash("MISSING")

    def __copy__(self):
        return self

    def __deepcopy__(self, memo: Any):
        return self


MISSING = MissingType()
