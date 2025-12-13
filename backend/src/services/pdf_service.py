"""
PDF generation service for receipts using WeasyPrint.

This service handles generating PDF receipts from receipt_data JSONB,
ensuring immutability and consistency between HTML display and PDF download.
"""

import logging
from pathlib import Path
from typing import Dict, Any

from jinja2 import Environment, FileSystemLoader, select_autoescape
from weasyprint import HTML  # type: ignore

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
    
    def generate_receipt_pdf(
        self,
        receipt_data: Dict[str, Any],
        is_voided: bool = False
    ) -> bytes:
        """
        Generate PDF receipt from receipt_data.
        
        Args:
            receipt_data: Receipt data from JSONB field (immutable snapshot)
            is_voided: Whether receipt is voided (for watermark)
            
        Returns:
            PDF file content as bytes
            
        Raises:
            Exception: If PDF generation fails
        """
        try:
            # Update void_info in receipt_data if voided
            if is_voided:
                receipt_data = receipt_data.copy()
                if 'void_info' not in receipt_data:
                    receipt_data['void_info'] = {}
                receipt_data['void_info']['voided'] = True
            
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
            # base_url is set to backend directory for resolving relative paths (fonts, images)
            pdf_bytes = HTML(
                string=html_content,
                base_url=str(self.base_dir)
            ).write_pdf(metadata=metadata)  # type: ignore[reportUnknownMemberType]
            
            if pdf_bytes is None:
                raise Exception("PDF generation returned None")
            
            return pdf_bytes
            
        except Exception as e:
            logger.exception(f"Error generating PDF receipt: {e}")
            raise
    
    def generate_receipt_html(
        self,
        receipt_data: Dict[str, Any],
        is_voided: bool = False
    ) -> str:
        """
        Generate HTML receipt for LIFF display.
        
        Uses the same template as PDF to ensure consistency.
        
        Args:
            receipt_data: Receipt data from JSONB field (immutable snapshot)
            is_voided: Whether receipt is voided (for watermark)
            
        Returns:
            HTML content as string
        """
        try:
            # Update void_info in receipt_data if voided
            if is_voided:
                receipt_data = receipt_data.copy()
                if 'void_info' not in receipt_data:
                    receipt_data['void_info'] = {}
                receipt_data['void_info']['voided'] = True
            
            # Load template
            template = self.env.get_template('receipts/receipt.html')
            
            # Render template with receipt_data
            html_content = template.render(receipt_data=receipt_data)
            
            return html_content
            
        except Exception as e:
            logger.exception(f"Error generating HTML receipt: {e}")
            raise

