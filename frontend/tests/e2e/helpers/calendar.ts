import { Page } from '@playwright/test';

/**
 * Calendar and appointment helpers for E2E tests
 */

export class CalendarHelper {
  constructor(private page: Page) {}

  /**
   * Navigate to calendar page
   */
  async gotoCalendar() {
    await this.page.goto('/admin/calendar', { waitUntil: 'load', timeout: 45000 });
    // Wait for calendar page to be ready - verify we're on the calendar URL
    // and page has loaded (not on login page)
    await this.page.waitForFunction(
      () => {
        const url = window.location.href;
        return url && url.includes('/admin/calendar') && !url.includes('/admin/login');
      },
      { timeout: 10000 }
    );
  }

  /**
   * Wait for calendar to load
   */
  async waitForCalendarLoad() {
    // Wait for calendar component to be visible
    await this.page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
  }

  /**
   * Click create appointment button
   */
  async clickCreateAppointment() {
    // Try desktop button first
    const desktopButton = this.page.locator('button:has-text("新增預約")').first();
    if (await desktopButton.isVisible()) {
      await desktopButton.click();
      return;
    }

    // Try mobile FAB button
    const fabButton = this.page.locator('[data-testid="fab-create-appointment"]');
    if (await fabButton.isVisible()) {
      await fabButton.click();
      return;
    }

    throw new Error('Create appointment button not found');
  }

  /**
   * Open create appointment modal
   */
  async openCreateAppointmentModal() {
    await this.clickCreateAppointment();

    // Wait for modal to appear
    await this.page.waitForSelector('[data-testid="appointment-modal"]', { timeout: 5000 });
  }

  /**
   * Select a patient in the appointment form
   */
  async selectPatient(patientName: string) {
    // Click patient selector
    await this.page.click('[data-testid="patient-selector"]');

    // Type patient name
    await this.page.fill('[placeholder*="搜尋病患"]', patientName);

    // Wait for and click the patient
    await this.page.click(`text=${patientName}`);
  }

  /**
   * Select appointment type
   */
  async selectAppointmentType(typeName: string) {
    await this.page.click('[data-testid="appointment-type-selector"]');
    await this.page.click(`text=${typeName}`);
  }

  /**
   * Select practitioner
   */
  async selectPractitioner(practitionerName: string) {
    await this.page.click('[data-testid="practitioner-selector"]');
    await this.page.click(`text=${practitionerName}`);
  }

  /**
   * Select date and time
   */
  async selectDateTime(date: string, time: string) {
    // Click date picker
    await this.page.click('[data-testid="date-picker"]');

    // Select date (assuming calendar widget)
    await this.page.click(`text=${date}`);

    // Select time slot
    await this.page.click(`[data-testid="time-slot"]:has-text("${time}")`);
  }

  /**
   * Fill appointment notes
   */
  async fillNotes(notes: string) {
    await this.page.fill('[name="clinic_notes"]', notes);
  }

  /**
   * Submit appointment form
   */
  async submitAppointment() {
    await this.page.click('button:has-text("確認")');
  }

  /**
   * Wait for appointment creation success
   */
  async waitForAppointmentCreated() {
    await this.page.waitForSelector('text=預約已建立', { timeout: 5000 });
  }

  /**
   * Verify appointment appears in calendar
   */
  async verifyAppointmentInCalendar(patientName: string) {
    await this.page.waitForSelector(`[data-testid="calendar-event"]:has-text("${patientName}")`, { timeout: 5000 });
  }

  /**
   * Create complete appointment
   */
  async createAppointment(appointmentData: {
    patientName: string;
    appointmentType: string;
    practitionerName: string;
    date: string;
    time: string;
    notes?: string;
  }) {
    await this.openCreateAppointmentModal();
    await this.selectPatient(appointmentData.patientName);
    await this.selectAppointmentType(appointmentData.appointmentType);
    await this.selectPractitioner(appointmentData.practitionerName);
    await this.selectDateTime(appointmentData.date, appointmentData.time);

    if (appointmentData.notes) {
      await this.fillNotes(appointmentData.notes);
    }

    await this.submitAppointment();
    await this.waitForAppointmentCreated();
    await this.verifyAppointmentInCalendar(appointmentData.patientName);
  }
}

/**
 * Create calendar helper for a page
 */
export function createCalendarHelper(page: Page): CalendarHelper {
  return new CalendarHelper(page);
}
