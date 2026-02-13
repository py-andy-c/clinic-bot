import copy
from typing import Any, Dict, cast

def deep_merge(target: Dict[str, Any], source: Dict[str, Any]) -> Dict[str, Any]:
    """
    Recursively merges source into a COPY of target.
    
    Logic:
    - If a key exists in source but not target -> Add it.
    - If a key exists in both and both are dicts -> Recurse.
    - If a key exists in both and is NOT a dict -> Overwrite with source value.
    - NOTE: Lists are NOT merged; they are treated as atomic values and overwritten.
    
    Returns a NEW dictionary (pure function). 
    This prevents accidental mutation of SQLAlchemy-managed objects.
    """
    # Create a deep copy of the target to ensure we don't mutate the original
    result = copy.deepcopy(target)
    
    for key, value in source.items():
        if (
            key in result 
            and isinstance(result.get(key), dict) 
            and isinstance(value, dict)
        ):
            # Recurse and assign the result to the key
            result[key] = deep_merge(cast(Dict[str, Any], result[key]), cast(Dict[str, Any], value))
        else:
            # Overwrite or add (use deepcopy for the value to be safe)
            result[key] = copy.deepcopy(value)
            
    return result
