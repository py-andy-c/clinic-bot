"""
PDF generation service for receipts using WeasyPrint.

This service handles generating PDF receipts from receipt_data JSONB,
ensuring immutability and consistency between HTML display and PDF download.
"""

import logging
from pathlib import Path
from typing import Dict, Any, Optional

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
    
    def generate_medical_record_pdf(
        self,
        record_data: Dict[str, Any]
    ) -> bytes:
        """
        Generate PDF medical record from record_data.
        
        Args:
            record_data: Dictionary containing:
                - id: Record ID
                - clinic_name: Clinic display name
                - patient_name: Patient full name
                - template_name: Name of the template used
                - created_at: ISO datetime string
                - updated_at: ISO datetime string
                - header_structure: List of field definitions
                - header_values: Dictionary of field values
                - workspace_data: WorkspaceData dictionary (layers, etc.)
            
        Returns:
            PDF file content as bytes
        """
        try:
            # Load template
            template = self.env.get_template('medical_records/record_pdf.html')
            
            # Calculate scaling: A4 is ~210mm. Minus 10mm margins on both sides = 190mm.
            # 190mm is roughly 718px at 96dpi.
            # However, WeasyPrint handles @page margins. We just need to fit 1000px logical width.
            # Let's use a scale factor that ensures it fits nicely on the page.
            # We'll pass it to the template for CSS transform.
            # Since we use width: 100% on medical-record, we can rely on CSS for some scaling,
            # but transform: scale() is more reliable for the 1000px workspace.
            
            # Calculate scaling to fit logical width into A4 printable width (~190mm)
            # 190mm is approx 718px at 96dpi. We use 0.72 as a safe default for 1000px logical width.
            logical_width = record_data.get('workspace_data', {}).get('canvas_width', 1000.0)
            target_width = 720.0
            scale_factor = target_width / logical_width
            
            # Render template
            html_content = template.render(
                record_data=record_data,
                scale_factor=scale_factor
            )
            
            # Metadata
            metadata = {
                'title': f"病歷記錄 - {record_data.get('patient_name', '')} - {record_data.get('created_at', '')[:10]}",
                'author': record_data.get('clinic_name', ''),
                'creator': 'Clinic Bot',
                'producer': 'WeasyPrint',
            }
            
            # Generate PDF
            pdf_bytes = HTML(
                string=html_content,
                base_url=str(self.base_dir)
            ).write_pdf(metadata=metadata)  # type: ignore
            
            if pdf_bytes is None:
                raise Exception("PDF generation returned None")
                
            return pdf_bytes
            
        except Exception as e:
            logger.exception(f"Error generating PDF medical record: {e}")
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

