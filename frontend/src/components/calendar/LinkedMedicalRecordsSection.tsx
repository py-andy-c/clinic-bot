import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePatientMedicalRecords } from '../../hooks/useMedicalRecords';
import { CreateMedicalRecordDialog } from '../CreateMedicalRecordDialog';
import { LoadingSpinner } from '../shared';
import { formatDateOnly } from '../../utils/calendarUtils';

interface LinkedMedicalRecordsSectionProps {
    patientId: number;
    appointmentId: number;
    clinicId: number | null;
}

export const LinkedMedicalRecordsSection: React.FC<LinkedMedicalRecordsSectionProps> = ({
    patientId,
    appointmentId,
    clinicId,
}) => {
    const navigate = useNavigate();
    const [showCreateDialog, setShowCreateDialog] = useState(false);

    const { data, isLoading } = usePatientMedicalRecords(
        clinicId,
        patientId,
        { appointment_id: appointmentId }
    );

    const activeRecords = data?.records?.filter(r => !r.is_deleted) || [];

    const handleCreate = () => {
        setShowCreateDialog(true);
    };

    const handleCreateSuccess = (recordId: number) => {
        setShowCreateDialog(false);
        // Navigate to the full-page editor
        navigate(`/admin/clinic/patients/${patientId}/records/${recordId}`);
    };

    const handleOpen = (recordId: number) => {
        // Navigate to the full-page editor
        navigate(`/admin/clinic/patients/${patientId}/records/${recordId}`);
    };

    if (isLoading) {
        return (
            <div className="flex justify-center p-4">
                <LoadingSpinner size="sm" />
            </div>
        );
    }

    return (
        <div className="mt-4 border-t pt-4">
            <div className="flex justify-between items-center mb-3">
                <h3 className="font-semibold text-gray-900">病歷記錄</h3>
                <button
                    onClick={handleCreate}
                    className="text-sm px-3 py-1 bg-primary-50 text-primary-600 rounded hover:bg-primary-100 transition-colors"
                >
                    + 新增病歷
                </button>
            </div>

            {activeRecords.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-2">
                    尚無關聯病歷
                </p>
            ) : (
                <div className="space-y-2">
                    {activeRecords.map(record => {
                        // Check if record is empty (no values or all values are empty)
                        const isEmpty = !record.values || Object.keys(record.values).length === 0 || 
                            Object.values(record.values).every(v => v === '' || v === null || v === undefined);

                        return (
                            <div
                                key={record.id}
                                className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border border-gray-100 hover:border-primary-200 transition-colors"
                            >
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <p className="font-medium text-gray-900">{record.template_snapshot.name}</p>
                                        {isEmpty && (
                                            <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                                                空白
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-gray-500">{formatDateOnly(record.created_at)}</p>
                                </div>
                                <button
                                    onClick={() => handleOpen(record.id)}
                                    className="text-xs px-3 py-1 bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors"
                                >
                                    開啟
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {showCreateDialog && (
                <CreateMedicalRecordDialog
                    patientId={patientId}
                    onClose={() => setShowCreateDialog(false)}
                    onSuccess={handleCreateSuccess}
                    defaultAppointmentId={appointmentId}
                />
            )}
        </div>
    );
};
