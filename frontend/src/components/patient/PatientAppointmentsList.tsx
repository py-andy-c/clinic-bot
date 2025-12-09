import React, { useState, useCallback, useEffect } from "react";
import {
  useApiData,
  invalidateCacheForFunction,
  invalidateCacheByPattern,
} from "../../hooks/useApiData";
import { apiService } from "../../services/api";
import { LoadingSpinner, ErrorMessage } from "../shared";
import moment from "moment-timezone";
import { formatAppointmentTimeRange } from "../../utils/calendarUtils";
import { renderStatusBadge } from "../../utils/appointmentStatus";
import { EditAppointmentModal } from "../calendar/EditAppointmentModal";
import { CancellationNoteModal } from "../calendar/CancellationNoteModal";
import { CancellationPreviewModal } from "../calendar/CancellationPreviewModal";
import { EventModal } from "../calendar/EventModal";
import {
  CalendarEvent,
  formatEventTimeRange,
} from "../../utils/calendarDataAdapter";
import { appointmentToCalendarEvent } from "./appointmentUtils";
import { useModal } from "../../contexts/ModalContext";
import { useAuth } from "../../hooks/useAuth";
import { getErrorMessage } from "../../types/api";
import { logger } from "../../utils/logger";

const TAIWAN_TIMEZONE = "Asia/Taipei";

interface PatientAppointmentsListProps {
  patientId: number;
  practitioners: Array<{ id: number; full_name: string }>;
  appointmentTypes: Array<{
    id: number;
    name: string;
    duration_minutes: number;
  }>;
  onRefetchReady?: (refetch: () => Promise<void>) => void;
}

type TabType = "future" | "completed" | "cancelled";

interface Appointment {
  id: number;
  calendar_event_id: number;
  patient_id: number;
  patient_name: string;
  practitioner_id: number;
  practitioner_name: string;
  appointment_type_id: number;
  appointment_type_name: string;
  event_name: string; // Effective calendar event name (custom_event_name or default format)
  start_time: string;
  end_time: string;
  status: string;
  notes?: string | null; // Patient-provided notes
  clinic_notes?: string | null; // Clinic internal notes
  line_display_name?: string | null;
  originally_auto_assigned?: boolean;
}

export const PatientAppointmentsList: React.FC<
  PatientAppointmentsListProps
> = ({ patientId, practitioners, appointmentTypes, onRefetchReady }) => {
  const [activeTab, setActiveTab] = useState<TabType>("future");
  const { alert } = useModal();
  const { hasRole } = useAuth();

  // Event modal state
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null,
  );

  // Edit appointment state
  const [editingAppointment, setEditingAppointment] =
    useState<CalendarEvent | null>(null);
  const [editErrorMessage, setEditErrorMessage] = useState<string | null>(null);

  // Delete appointment state
  const [deletingAppointment, setDeletingAppointment] =
    useState<CalendarEvent | null>(null);
  const [cancellationNote, setCancellationNote] = useState<string>("");
  const [cancellationPreviewMessage, setCancellationPreviewMessage] =
    useState<string>("");
  const [cancellationPreviewLoading, setCancellationPreviewLoading] =
    useState(false);
  const [deleteStep, setDeleteStep] = useState<"note" | "preview" | null>(null);

  // Check if user can edit appointments
  const canEdit = hasRole && (hasRole("admin") || hasRole("practitioner"));
  const canEditEvent = useCallback(
    (event: CalendarEvent | null): boolean => {
      if (!event || !canEdit) return false;
      // In patient detail page, any admin or practitioner can edit any appointment
      return event.resource.type === "appointment";
    },
    [canEdit],
  );

  // Fetch ALL appointments once (no filters) so we can calculate accurate counts for all tabs
  const fetchAppointments = useCallback(() => {
    return apiService.getPatientAppointments(
      patientId,
      undefined, // No status filter - get all appointments
      false, // No upcoming_only filter - get all appointments
    );
  }, [patientId]);

  const { data, loading, error, refetch, setData } = useApiData<{
    appointments: Appointment[];
  }>(fetchAppointments, {
    enabled: !!patientId,
    dependencies: [patientId], // Only depend on patientId, not activeTab
    defaultErrorMessage: "無法載入預約記錄",
    // Cache key now includes patientId via dependencies, so caching is safe
  });

  const allAppointments = data?.appointments || [];

  // Helper function to check if event data has changed
  const hasEventDataChanged = useCallback(
    (current: CalendarEvent, updated: CalendarEvent): boolean => {
      return (
        current.title !== updated.title ||
        current.resource.clinic_notes !== updated.resource.clinic_notes ||
        current.resource.notes !== updated.resource.notes
      );
    },
    [],
  );

  // Update selectedEvent when appointments data changes (e.g., after refresh)
  useEffect(() => {
    if (!selectedEvent || allAppointments.length === 0) return;

    const updatedAppointment = allAppointments.find(
      (apt) =>
        (apt.calendar_event_id ?? apt.id) ===
        selectedEvent.resource.calendar_event_id,
    );

    if (!updatedAppointment) return;

    try {
      const updatedEvent = appointmentToCalendarEvent(updatedAppointment);
      // Only update if something actually changed (to avoid unnecessary re-renders)
      if (hasEventDataChanged(selectedEvent, updatedEvent)) {
        setSelectedEvent(updatedEvent);
      }
    } catch (error) {
      logger.error("Error updating selected event:", error);
    }
  }, [allAppointments, selectedEvent, hasEventDataChanged]);

  // Get current time in Taiwan timezone for comparisons
  const nowInTaiwan = moment.tz(TAIWAN_TIMEZONE);

  // Calculate counts and filter appointments for all tabs
  // All times are interpreted as Taiwan time
  const futureAppointments = allAppointments
    .filter((apt) => {
      const startTime = moment.tz(apt.start_time, TAIWAN_TIMEZONE);
      // Use isSameOrAfter to include appointments happening exactly "now"
      return startTime.isSameOrAfter(nowInTaiwan) && apt.status === "confirmed";
    })
    .sort((a, b) => {
      // Sort from sooner to further (ascending by start_time)
      const timeA = moment.tz(a.start_time, TAIWAN_TIMEZONE);
      const timeB = moment.tz(b.start_time, TAIWAN_TIMEZONE);
      return timeA.valueOf() - timeB.valueOf();
    });
  const completedAppointments = allAppointments.filter((apt) => {
    const startTime = moment.tz(apt.start_time, TAIWAN_TIMEZONE);
    // Use isBefore to exclude appointments happening exactly "now" (they appear in future)
    return startTime.isBefore(nowInTaiwan) && apt.status === "confirmed";
  });
  const cancelledAppointments = allAppointments.filter(
    (apt) =>
      apt.status === "canceled_by_patient" ||
      apt.status === "canceled_by_clinic",
  );

  const displayAppointments =
    activeTab === "future"
      ? futureAppointments
      : activeTab === "completed"
        ? completedAppointments
        : cancelledAppointments;

  // Helper function to refresh appointments list after mutations
  const refreshAppointmentsList = useCallback(async () => {
    // Invalidate cache for appointments list using pattern to catch all variations
    invalidateCacheByPattern(`api_getPatientAppointments`);
    invalidateCacheForFunction(fetchAppointments);

    // Force a fresh fetch by directly calling the API and updating data
    // This ensures we get fresh data regardless of cache state
    try {
      const freshData = await fetchAppointments();
      setData(freshData);
    } catch (fetchError) {
      // If direct fetch fails, try refetch as fallback
      logger.warn("Direct fetch failed, trying refetch:", fetchError);
      await refetch();
    }
  }, [fetchAppointments, setData, refetch]);

  // Expose refetch function to parent component
  useEffect(() => {
    if (onRefetchReady) {
      onRefetchReady(refreshAppointmentsList);
    }
  }, [onRefetchReady, refreshAppointmentsList]);

  // Handle appointment card click - open EventModal
  const handleAppointmentClick = useCallback(
    async (appointment: Appointment) => {
      try {
        const event = appointmentToCalendarEvent(appointment);
        setSelectedEvent(event);
      } catch (error) {
        logger.error("Error converting appointment to calendar event:", error);
        await alert("無法載入預約資料，請重新整理頁面", "錯誤");
      }
    },
    [],
  );

  // Handle edit appointment from EventModal
  const handleEditAppointment = useCallback(async () => {
    if (!selectedEvent) return;

    if (!canEditEvent(selectedEvent)) {
      await alert("您只能編輯自己的預約");
      return;
    }

    setEditingAppointment(selectedEvent);
    setEditErrorMessage(null);
    setSelectedEvent(null); // Close EventModal
  }, [selectedEvent, canEditEvent]);

  // Handle delete appointment from EventModal
  const handleDeleteAppointment = useCallback(async () => {
    if (!selectedEvent || !selectedEvent.resource.appointment_id) return;

    if (!canEditEvent(selectedEvent)) {
      await alert("您只能取消自己的預約");
      return;
    }

    // Reset cancellation note and show note input modal
    setCancellationNote("");
    setCancellationPreviewMessage("");
    setDeletingAppointment(selectedEvent);
    setDeleteStep("note");
    setSelectedEvent(null); // Close EventModal
  }, [selectedEvent, canEditEvent]);

  // Edit appointment handler
  const handleEditConfirm = async (formData: {
    practitioner_id: number | null;
    start_time: string;
    clinic_notes?: string;
    notification_note?: string;
  }) => {
    if (!editingAppointment) return;

    try {
      await apiService.editClinicAppointment(
        editingAppointment.resource.calendar_event_id,
        formData,
      );

      // Refresh appointments list
      await refreshAppointmentsList();

      setEditingAppointment(null);
      setEditErrorMessage(null);
      await alert("預約已更新");
    } catch (error) {
      logger.error("Error editing appointment:", error);
      const errorMessage = getErrorMessage(error);
      setEditErrorMessage(errorMessage);
      // Don't throw - let the modal handle the error display
    }
  };

  // Handle event name update from EventModal
  const handleEventNameUpdated = useCallback(
    async (_newName: string | null) => {
      // Refresh appointments list to get updated data
      // The useEffect above will automatically update selectedEvent when allAppointments changes
      await refreshAppointmentsList();
    },
    [refreshAppointmentsList],
  );

  // Delete appointment handlers
  const handleCancellationNoteSubmit = async () => {
    if (!deletingAppointment) return;

    setCancellationPreviewLoading(true);
    try {
      const response = await apiService.generateCancellationPreview({
        appointment_type:
          deletingAppointment.resource.appointment_type_name || "",
        appointment_time: formatAppointmentTimeRange(
          deletingAppointment.start,
          deletingAppointment.end,
        ),
        therapist_name: deletingAppointment.resource.practitioner_name || "",
        patient_name: deletingAppointment.resource.patient_name || "",
        ...(cancellationNote.trim() && { note: cancellationNote.trim() }),
      });

      setCancellationPreviewMessage(response.preview_message);
      setDeleteStep("preview");
    } catch (error) {
      logger.error("Error generating cancellation preview:", error);
      const errorMessage = getErrorMessage(error);
      await alert(`無法產生預覽訊息：${errorMessage}`, "錯誤");
      // Stay on note step so user can retry
    } finally {
      setCancellationPreviewLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingAppointment || !deletingAppointment.resource.calendar_event_id)
      return;

    try {
      // Note: cancelClinicAppointment API uses calendar_event_id despite parameter name
      await apiService.cancelClinicAppointment(
        deletingAppointment.resource.calendar_event_id,
        cancellationNote.trim() || undefined,
      );

      // Refresh appointments list
      await refreshAppointmentsList();

      setDeletingAppointment(null);
      setCancellationNote("");
      setCancellationPreviewMessage("");
      setDeleteStep(null);
      await alert("預約已取消");
    } catch (error) {
      logger.error("Error deleting appointment:", error);
      const errorMessage = getErrorMessage(error);
      await alert(`取消預約失敗：${errorMessage}`, "錯誤");
      // Stay on preview step so user can retry or go back
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
        <ErrorMessage message={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-4">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">預約記錄</h2>

      <div className="border-b border-gray-200 mb-4">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab("future")}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === "future"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            未來預約 ({futureAppointments.length})
          </button>
          <button
            onClick={() => setActiveTab("completed")}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === "completed"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            已完成 ({completedAppointments.length})
          </button>
          <button
            onClick={() => setActiveTab("cancelled")}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === "cancelled"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            已取消 ({cancelledAppointments.length})
          </button>
        </nav>
      </div>

      {displayAppointments.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>
            目前沒有
            {activeTab === "future"
              ? "未來"
              : activeTab === "completed"
                ? "已完成"
                : "已取消"}
            的預約
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {displayAppointments.map((appointment) => (
            <div
              key={appointment.id}
              onClick={() => handleAppointmentClick(appointment)}
              className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
            >
              <div className="flex justify-between items-start mb-2 gap-2">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900">
                    {appointment.event_name}
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {formatAppointmentTimeRange(
                      new Date(appointment.start_time),
                      new Date(appointment.end_time),
                    )}
                  </p>
                </div>
                <div className="flex-shrink-0 flex items-center gap-2">
                  {renderStatusBadge(appointment.status) && (
                    <div className="flex-shrink-0">
                      {renderStatusBadge(appointment.status)}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-2 space-y-1">
                <div className="flex items-center text-sm text-gray-600">
                  <svg
                    className="w-4 h-4 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                  {appointment.practitioner_name}
                </div>

                {appointment.notes && (
                  <div className="text-sm text-gray-600 mt-2">
                    <span className="font-medium">病患備註：</span>
                    {appointment.notes}
                  </div>
                )}
                {appointment.clinic_notes && (
                  <div className="text-sm text-gray-600 mt-2">
                    <span className="font-medium">診所備注：</span>
                    {appointment.clinic_notes}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Event Modal */}
      {selectedEvent && (
        <EventModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onDeleteAppointment={
            canEditEvent(selectedEvent) &&
            selectedEvent.resource.type === "appointment"
              ? handleDeleteAppointment
              : undefined
          }
          onEditAppointment={
            canEditEvent(selectedEvent) &&
            selectedEvent.resource.type === "appointment"
              ? handleEditAppointment
              : undefined
          }
          formatAppointmentTime={formatEventTimeRange}
          hidePatientInfo={true}
          onEventNameUpdated={handleEventNameUpdated}
        />
      )}

      {/* Edit Appointment Modal */}
      {editingAppointment && (
        <EditAppointmentModal
          event={editingAppointment}
          practitioners={practitioners}
          appointmentTypes={appointmentTypes}
          onClose={() => {
            setEditingAppointment(null);
            setEditErrorMessage(null);
          }}
          onConfirm={handleEditConfirm}
          formatAppointmentTime={formatAppointmentTimeRange}
          errorMessage={editErrorMessage}
        />
      )}

      {/* Cancellation Note Modal */}
      {deletingAppointment && deleteStep === "note" && (
        <CancellationNoteModal
          cancellationNote={cancellationNote}
          isLoading={cancellationPreviewLoading}
          onNoteChange={setCancellationNote}
          onBack={() => {
            setDeletingAppointment(null);
            setDeleteStep(null);
            setCancellationNote("");
          }}
          onSubmit={handleCancellationNoteSubmit}
        />
      )}

      {/* Cancellation Preview Modal */}
      {deletingAppointment && deleteStep === "preview" && (
        <CancellationPreviewModal
          previewMessage={cancellationPreviewMessage}
          onBack={() => setDeleteStep("note")}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  );
};
