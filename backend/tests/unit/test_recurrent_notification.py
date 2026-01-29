import pytest
from datetime import datetime
from unittest.mock import MagicMock
from services.message_template_service import MessageTemplateService
from models import Patient, Clinic

def test_build_recurrent_confirmation_context():
    # Setup mock objects
    patient = MagicMock(spec=Patient)
    patient.full_name = "王小明"
    
    clinic = MagicMock(spec=Clinic)
    clinic.effective_display_name = "範例診所"
    clinic.address = "台北市信義區"
    clinic.phone_number = "02-12345678"
    
    appointment_type_name = "回診"
    practitioner_display_name = "李醫師"
    appointment_count = 5
    appointment_list_text = "1. 01/01 (四) 14:00\n2. 01/08 (四) 14:00..."
    
    context = MessageTemplateService.build_recurrent_confirmation_context(
        patient=patient,
        appointment_type_name=appointment_type_name,
        practitioner_display_name=practitioner_display_name,
        clinic=clinic,
        appointment_count=appointment_count,
        appointment_list_text=appointment_list_text
    )
    
    assert context["病患姓名"] == "王小明"
    assert context["預約數量"] == "5"
    assert context["預約時段列表"] == appointment_list_text
    assert context["服務項目"] == "回診"
    assert context["治療師姓名"] == "李醫師"
    assert context["診所名稱"] == "範例診所"

def test_render_recurrent_message():
    template = "{病患姓名}，已為您建立 {預約數量} 個預約：\n\n{預約時段列表}\n\n【{服務項目}】{治療師姓名}"
    context = {
        "病患姓名": "張三",
        "預約數量": "3",
        "預約時段列表": "1. 02/01 (一) 10:00\n2. 02/02 (二) 10:00\n3. 02/03 (三) 10:00",
        "服務項目": "物理治療",
        "治療師姓名": "陳老師"
    }
    
    rendered = MessageTemplateService.render_message(template, context)
    
    assert "張三" in rendered
    assert "3 個預約" in rendered
    assert "物理治療" in rendered
    assert "陳老師" in rendered
    assert "1. 02/01 (一) 10:00" in rendered
