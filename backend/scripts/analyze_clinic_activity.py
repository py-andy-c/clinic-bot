"""
./venv/bin/python scripts/analyze_clinic_activity.py --url "postgresql://postgres:xxxx" --name "透視物理治療所 台北中山"
"""
import argparse
import sys
import os
import json
from datetime import datetime, timedelta
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

def analyze_clinic(db_url, clinic_name):
    engine = create_engine(db_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        # 1. Find the clinic
        clinic_query = text("SELECT id, name, settings, created_at, subscription_status FROM clinics WHERE name = :name")
        clinic = session.execute(clinic_query, {"name": clinic_name}).fetchone()

        if not clinic:
            print(f"Clinic '{clinic_name}' not found.")
            return

        clinic_id, name, settings, created_at, subscription_status = clinic
        
        print(f"\n=== Analysis for Clinic: {name} (ID: {clinic_id}) ===")
        print(f"Created at: {created_at}")
        print(f"Subscription Status: {subscription_status}")

        # 2. Activity Metrics
        
        # Patients
        patient_count = session.execute(text("SELECT COUNT(*) FROM patients WHERE clinic_id = :cid AND is_deleted = false"), {"cid": clinic_id}).scalar()
        
        # LINE Users
        line_user_count = session.execute(text("SELECT COUNT(*) FROM line_users WHERE clinic_id = :cid"), {"cid": clinic_id}).scalar()
        
        # Appointments
        total_appointments = session.execute(text("SELECT COUNT(*) FROM calendar_events ce JOIN appointments a ON ce.id = a.calendar_event_id WHERE ce.clinic_id = :cid"), {"cid": clinic_id}).scalar()
        
        confirmed_appointments = session.execute(text("SELECT COUNT(*) FROM calendar_events ce JOIN appointments a ON ce.id = a.calendar_event_id WHERE ce.clinic_id = :cid AND a.status = 'confirmed'"), {"cid": clinic_id}).scalar()
        
        canceled_appointments = session.execute(text("SELECT COUNT(*) FROM calendar_events ce JOIN appointments a ON ce.id = a.calendar_event_id WHERE ce.clinic_id = :cid AND a.status LIKE 'canceled%'"), {"cid": clinic_id}).scalar()

        # Recent activity (last 30 days)
        thirty_days_ago = datetime.now() - timedelta(days=30)
        recent_appointments = session.execute(text(
            "SELECT COUNT(*) FROM calendar_events ce JOIN appointments a ON ce.id = a.calendar_event_id "
            "WHERE ce.clinic_id = :cid AND ce.date >= :date"
        ), {"cid": clinic_id, "date": thirty_days_ago.date()}).scalar()

        # Practitioners (Users associated via UserClinicAssociation)
        practitioner_count = session.execute(text("SELECT COUNT(*) FROM user_clinic_associations WHERE clinic_id = :cid"), {"cid": clinic_id}).scalar()

        # LINE Messages activity
        message_count = session.execute(text("SELECT COUNT(*) FROM line_messages WHERE clinic_id = :cid"), {"cid": clinic_id}).scalar()
        ai_reply_count = session.execute(text("SELECT COUNT(*) FROM line_ai_replies WHERE clinic_id = :cid"), {"cid": clinic_id}).scalar()

        print("\n--- Usage Metrics ---")
        print(f"Total Patients: {patient_count}")
        print(f"Total LINE Users: {line_user_count}")
        print(f"Total Practitioners: {practitioner_count}")
        print(f"Total Appointments: {total_appointments}")
        print(f"  - Confirmed: {confirmed_appointments}")
        print(f"  - Canceled: {canceled_appointments}")
        print(f"Recent Appointments (Last 30 Days): {recent_appointments}")
        print(f"Total Incoming LINE Messages: {message_count}")
        print(f"Total AI Bot Replies: {ai_reply_count}")

        # 3. Features & Settings
        print("\n--- Feature Configuration ---")
        
        settings_dict = settings if isinstance(settings, dict) else json.loads(settings)
        
        # Check specific features
        chat_settings = settings_dict.get("chat_settings", {})
        ai_enabled = chat_settings.get("chat_enabled", False)
        print(f"AI Chatbot: {'ENABLED' if ai_enabled else 'DISABLED'}")
        
        receipt_settings = settings_dict.get("receipt_settings", {})
        receipts_enabled = receipt_settings.get("show_stamp", False)
        print(f"Receipt Printing: {'ENABLED' if receipts_enabled else 'DISABLED'}")
        
        booking_settings = settings_dict.get("booking_restriction_settings", {})
        print(f"Booking Restriction: {booking_settings.get('booking_restriction_type', 'N/A')}")
        print(f"Min Booking Hours Ahead: {booking_settings.get('minimum_booking_hours_ahead', 'N/A')}")
        
        # Resource management
        resource_count = session.execute(text("SELECT COUNT(*) FROM resources WHERE clinic_id = :cid"), {"cid": clinic_id}).scalar()
        print(f"Resources Managed: {resource_count}")

        # Appointment Types
        app_types = session.execute(text("SELECT name FROM appointment_types WHERE clinic_id = :cid AND is_deleted = false"), {"cid": clinic_id}).fetchall()
        print(f"Active Appointment Types ({len(app_types)}):")
        for at in app_types:
            print(f"  - {at[0]}")

        # 4. Future Appointments Summary
        print("\n--- Future Appointments Analysis ---")
        now = datetime.now()
        today = now.date()
        
        future_appointments = session.execute(text(
            "SELECT ce.date, COUNT(*) as count "
            "FROM calendar_events ce "
            "JOIN appointments a ON ce.id = a.calendar_event_id "
            "WHERE ce.clinic_id = :cid AND ce.date >= :today AND a.status = 'confirmed' "
            "GROUP BY ce.date "
            "ORDER BY ce.date ASC"
        ), {"cid": clinic_id, "today": today}).fetchall()

        total_future = sum(fa[1] for fa in future_appointments)
        print(f"Total Confirmed Future Appointments: {total_future}")

        if future_appointments:
            print("\nTime Distribution (Next 14 Days with appointments):")
            max_date = today + timedelta(days=14)
            for row in future_appointments:
                date_val, count = row
                if date_val <= max_date:
                    print(f"  - {date_val}: {count} appointments")
            
            # Weekly distribution (next 4 weeks)
            print("\nWeekly Distribution:")
            weekly_counts = {}
            for row in future_appointments:
                date_val, count = row
                # Calculate week start (Monday)
                week_start = date_val - timedelta(days=date_val.weekday())
                weekly_counts[week_start] = weekly_counts.get(week_start, 0) + count
            
            sorted_weeks = sorted(weekly_counts.keys())
            for week in sorted_weeks:
                print(f"  - Week of {week}: {weekly_counts[week]} appointments")

        # Detailed settings dump (optional)
        print("\n--- Detailed Settings ---")
        print(json.dumps(settings_dict, indent=2, ensure_ascii=False))

    finally:
        session.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Analyze clinic activity and settings.")
    parser.add_argument("--url", required=True, help="Database URL")
    parser.add_argument("--name", required=True, help="Clinic Name")
    
    args = parser.parse_args()
    analyze_clinic(args.url, args.name)
