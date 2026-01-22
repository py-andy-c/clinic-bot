import { CalendarEvent } from './calendarDataAdapter';

/**
 * Calculate display text for calendar events following main branch logic
 * Handles resource events, practitioner events, clinic notes, and resources
 */
export function calculateEventDisplayText(event: CalendarEvent): string {
  const isResourceEvent = event.resource.is_resource_event === true;
  const resourceName = event.resource.resource_name;
  const clinicNotes = event.resource.clinic_notes || '';
  const resourceNames = event.resource.resource_names || [];

  let displayText: string;

  if (isResourceEvent && resourceName) {
    // Resource calendar event: show resource name prefix
    const resourceText = resourceNames.length > 0 ? ` ${resourceNames.join(' ')}` : '';
    const baseTitle = event.title ? `[${resourceName}] ${event.title}${resourceText}` : `[${resourceName}]`;
    displayText = clinicNotes ? `${baseTitle} | ${clinicNotes}` : baseTitle;
  } else {
    // Practitioner calendar event: existing format
    const resourceText = resourceNames.length > 0 ? ` ${resourceNames.join(' ')}` : '';
    const baseTitle = event.title ? `${event.title}${resourceText}` : '';
    displayText = clinicNotes ? `${baseTitle} | ${clinicNotes}` : baseTitle;
  }

  // Fallback to just title if displayText is empty
  return displayText || event.title || '';
}

/**
 * Build tooltip text for calendar events following main branch logic
 */
export function buildEventTooltipText(event: CalendarEvent, timeStr: string): string {
  const isResourceEvent = event.resource.is_resource_event === true;
  const resourceName = event.resource.resource_name;
  const practitionerName = event.resource.event_practitioner_name || event.resource.practitioner_name;
  const showPractitionerName = practitionerName && !event.resource.is_primary && !isResourceEvent;
  const finalDisplayText = calculateEventDisplayText(event);

  const tooltipParts: string[] = [];
  if (isResourceEvent && resourceName) {
    tooltipParts.push(`資源: ${resourceName}`);
  } else if (showPractitionerName) {
    tooltipParts.push(practitionerName);
  }
  if (finalDisplayText) {
    tooltipParts.push(finalDisplayText);
  }
  tooltipParts.push(timeStr);

  return tooltipParts.join(' - ');
}