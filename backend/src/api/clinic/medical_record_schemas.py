from typing import List, Optional, Dict, Any, Literal, Union, Annotated
from pydantic import BaseModel, Field, field_validator


class DrawingPath(BaseModel):
    """Vector drawing path data."""
    type: Literal['drawing'] = 'drawing'
    id: Optional[str] = None
    tool: Literal['pen', 'eraser', 'highlighter']
    color: str
    width: float = Field(gt=0)
    points: List[List[float]]  # Array of [x, y, pressure?] coordinates
    boundingBox: Optional[Dict[str, float]] = None

    @field_validator('points')
    @classmethod
    def validate_points(cls, v: List[List[float]]) -> List[List[float]]:
        for point in v:
            if not (2 <= len(point) <= 3):
                raise ValueError("Each point must have 2 or 3 coordinates [x, y, pressure?]")
        return v


class MediaLayer(BaseModel):
    """Media layer (image) in the workspace."""
    type: Literal['media'] = 'media'
    id: Union[str, int]
    origin: Literal['template', 'upload']
    url: str
    x: float
    y: float
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    rotation: float = 0.0


class ShapeLayer(BaseModel):
    """Shape layer (rectangle, circle, arrow) in the workspace."""
    type: Literal['shape'] = 'shape'
    id: str
    tool: Literal['rectangle', 'circle', 'arrow']
    x: float
    y: float
    width: float
    height: float
    rotation: float = 0.0
    stroke: str
    strokeWidth: float
    fill: Optional[str] = None


class TextLayer(BaseModel):
    """Text layer in the workspace."""
    type: Literal['text'] = 'text'
    id: str
    text: str
    x: float
    y: float
    fontSize: float
    fontFamily: Optional[str] = None
    fontStyle: Optional[str] = None
    fill: str
    width: Optional[float] = None
    rotation: float = 0.0


# Union of all possible layer types
AnyLayer = Annotated[
    Union[DrawingPath, MediaLayer, ShapeLayer, TextLayer],
    Field(discriminator='type')
]
