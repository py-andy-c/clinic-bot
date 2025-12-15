"""
PDF generation service for receipts using WeasyPrint.

This service handles generating PDF receipts from receipt_data JSONB,
ensuring immutability and consistency between HTML display and PDF download.
"""

import logging
import re
from pathlib import Path
from typing import Dict, Any, Optional

from jinja2 import Environment, FileSystemLoader, select_autoescape
from weasyprint import HTML, CSS  # type: ignore
from weasyprint.text.fonts import FontConfiguration  # type: ignore

from utils.datetime_utils import parse_datetime_string_to_taiwan

logger = logging.getLogger(__name__)


class PDFService:
    """
    Service for generating PDF receipts from receipt_data.
    
    Uses WeasyPrint to convert HTML templates to PDF, ensuring
    consistency between HTML display and PDF download.
    """
    
    def __init__(self):
        """Initialize PDF service with template loader."""
        # Get template directory (backend/templates)
        template_dir = Path(__file__).parent.parent.parent / "templates"
        self.env = Environment(
            loader=FileSystemLoader(str(template_dir)),
            autoescape=select_autoescape(['html', 'xml'])
        )
        
        # Add custom filter for currency formatting
        def format_currency(value: float) -> str:
            """Format float as currency string with comma separators (e.g., 2500 -> '2,500')."""
            rounded = round(value)
            # Format with comma separators
            return f"{rounded:,}"
        
        def format_date_only(dt_str: str) -> str:
            """Format ISO datetime string as date only (YYYY-MM-DD) in Taiwan timezone."""
            try:
                dt = parse_datetime_string_to_taiwan(dt_str)
                return dt.strftime('%Y-%m-%d')
            except (ValueError, AttributeError) as e:
                logger.warning(f"Error formatting date: {dt_str}, error: {e}")
                return dt_str  # Return original if parsing fails
        
        def format_datetime_full(dt_str: str) -> str:
            """Format ISO datetime string as date and time (YYYY-MM-DD HH:MM:SS) in Taiwan timezone."""
            try:
                dt = parse_datetime_string_to_taiwan(dt_str)
                return dt.strftime('%Y-%m-%d %H:%M:%S')
            except (ValueError, AttributeError) as e:
                logger.warning(f"Error formatting datetime: {dt_str}, error: {e}")
                return dt_str  # Return original if parsing fails
        
        self.env.filters['format_currency'] = format_currency
        self.env.filters['format_date_only'] = format_date_only
        self.env.filters['format_datetime_full'] = format_datetime_full
        
        # Get base directory for resolving relative paths (fonts, images)
        self.base_dir = Path(__file__).parent.parent.parent
        
        # Get absolute path to font file for WeasyPrint (needs filesystem path, not URL)
        # Resolve immediately to get absolute path regardless of working directory
        self.font_path = (self.base_dir / "fonts" / "NotoSansTC-Regular.otf").resolve()
        
        # Load font file as base64 for embedding in CSS
        # This bypasses Fontconfig/Pango path resolution issues
        # WeasyPrint can load fonts from base64 data URIs in CSS @font-face
        import base64
        if self.font_path.exists():
            with open(self.font_path, 'rb') as f:
                font_data = f.read()
                self.font_base64 = base64.b64encode(font_data).decode('utf-8')
                logger.info(f"[TEMP DEBUG] Font loaded as base64: {len(self.font_base64)} chars")
        else:
            logger.warning(f"⚠️  Font file not found at {self.font_path}")
            self.font_base64 = None
        
        # [TEMP DEBUG] Log font path information for production debugging
        logger.info(f"[TEMP DEBUG] Font path check:")
        logger.info(f"[TEMP DEBUG]   base_dir: {self.base_dir}")
        logger.info(f"[TEMP DEBUG]   font_path (absolute): {self.font_path}")
        logger.info(f"[TEMP DEBUG]   font_path exists: {self.font_path.exists()}")
        logger.info(f"[TEMP DEBUG]   font_path is_file: {self.font_path.is_file()}")
        if self.font_path.exists():
            logger.info(f"[TEMP DEBUG]   font_path size: {self.font_path.stat().st_size} bytes")
    
    def generate_receipt_pdf(
        self,
        receipt_data: Dict[str, Any],
        void_info: Optional[Dict[str, Any]] = None
    ) -> bytes:
        """
        Generate PDF receipt from receipt_data.
        
        Args:
            receipt_data: Receipt data from JSONB field (immutable snapshot)
            void_info: Void information from database columns (merged into receipt_data for template)
            
        Returns:
            PDF file content as bytes
            
        Raises:
            Exception: If PDF generation fails
        """
        try:
            # Merge void_info into receipt_data for template (void_info is not stored in JSONB)
            receipt_data = receipt_data.copy()
            if void_info is None:
                void_info = {"voided": False, "voided_at": None, "voided_by": None, "reason": None}
            receipt_data['void_info'] = void_info
            
            # Load template
            template = self.env.get_template('receipts/receipt.html')
            
            # Render template with receipt_data
            html_content = template.render(receipt_data=receipt_data)
            
            # Prepare PDF metadata
            receipt_number = receipt_data.get('receipt_number', '')
            clinic_name = receipt_data.get('clinic', {}).get('display_name', '')
            issue_date = receipt_data.get('issue_date', '')
            
            # Parse issue_date to datetime if it's a string
            from datetime import datetime
            creation_date = None
            if issue_date:
                try:
                    # Handle ISO format strings
                    if 'T' in issue_date:
                        creation_date = datetime.fromisoformat(issue_date.replace('Z', '+00:00'))
                    else:
                        creation_date = datetime.fromisoformat(issue_date)
                except (ValueError, AttributeError):
                    # If parsing fails, use current time
                    creation_date = datetime.now()
            
            metadata = {
                'title': f'收據 {receipt_number}',
                'author': clinic_name,
                'subject': receipt_number,
                'creator': 'Clinic Bot',
                'producer': 'WeasyPrint',
            }
            if creation_date:
                metadata['creation_date'] = creation_date
            
            # Generate PDF using WeasyPrint
            # [TEMP DEBUG] Log original HTML to see font path
            font_url_match = re.search(r"url\(['\"]?/fonts/NotoSansTC-Regular\.otf['\"]?\)", html_content)
            if font_url_match:
                logger.info(f"[TEMP DEBUG] Found font URL in original HTML: {font_url_match.group()}")
            else:
                logger.warning(f"[TEMP DEBUG] Font URL not found in original HTML!")
            
            # Try multiple approaches to fix font loading:
            # Approach 1: Use file:// protocol with absolute path
            # Approach 2: Use relative path from base_url
            # Approach 3: Use direct absolute path (current approach)
            
            # SOLUTION: Use font by name (not path) - font is installed system-wide
            # WeasyPrint uses Fontconfig which expects fonts in system directories
            # Font is installed to ~/.local/share/fonts/ during startup (see start.sh)
            # CSS @font-face should use font-family name, Fontconfig will find it
            # Remove the @font-face rule entirely - Fontconfig will find the font by name
            # OR keep @font-face but use local() to reference system font
            html_content_for_pdf = re.sub(
                r"@font-face\s*\{[^}]*font-family:\s*['\"]?NotoSansTC['\"]?[^}]*src:\s*url\([^)]+\)[^}]*\}",
                lambda m: "@font-face {\n            font-family: 'NotoSansTC';\n            src: local('Noto Sans TC Regular'), local('NotoSansTC-Regular');\n        }",
                html_content,
                flags=re.DOTALL
            )
            logger.info(f"[TEMP DEBUG] Using system font (installed via Fontconfig)")
            logger.info(f"[TEMP DEBUG] Font should be found by name 'NotoSansTC' or 'Noto Sans TC Regular'")
            
            # Use FontConfiguration (required for proper font loading in some WeasyPrint versions)
            font_config = FontConfiguration()
            
            # Create HTML object with base_url for resolving other resources (images, etc.)
            # base_url is still needed for other relative paths in the HTML
            html_doc = HTML(
                string=html_content_for_pdf,
                base_url=str(self.base_dir)
            )
            
            # Generate PDF with FontConfiguration
            pdf_bytes = html_doc.write_pdf(
                metadata=metadata,
                font_config=font_config
            )  # type: ignore[reportUnknownMemberType]
            
            # [TEMP DEBUG] Log success
            logger.info(f"[TEMP DEBUG] PDF generated successfully, size: {len(pdf_bytes)} bytes")
            
            if pdf_bytes is None:
                raise Exception("PDF generation returned None")
            
            return pdf_bytes
            
        except Exception as e:
            logger.exception(f"Error generating PDF receipt: {e}")
            raise
    
    def generate_receipt_html(
        self,
        receipt_data: Dict[str, Any],
        void_info: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Generate HTML receipt for LIFF display.
        
        Uses the same template as PDF to ensure consistency.
        
        Args:
            receipt_data: Receipt data from JSONB field (immutable snapshot)
            void_info: Void information from database columns (merged into receipt_data for template)
            
        Returns:
            HTML content as string
        """
        try:
            # Merge void_info into receipt_data for template (void_info is not stored in JSONB)
            receipt_data = receipt_data.copy()
            if void_info is None:
                void_info = {"voided": False, "voided_at": None, "voided_by": None, "reason": None}
            receipt_data['void_info'] = void_info
            
            # Load template
            template = self.env.get_template('receipts/receipt.html')
            
            # Render template with receipt_data
            html_content = template.render(receipt_data=receipt_data)
            
            return html_content
            
        except Exception as e:
            logger.exception(f"Error generating HTML receipt: {e}")
            raise

