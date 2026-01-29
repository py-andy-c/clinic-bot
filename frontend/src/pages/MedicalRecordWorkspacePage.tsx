import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { LoadingSpinner, Button } from '../components/shared';
import { MedicalRecord, MedicalRecordTemplate } from '../types';
import { logger } from '../utils/logger';
import moment from 'moment';

const MedicalRecordWorkspacePage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const recordId = id ? parseInt(id, 10) : undefined;

    const { data: record, isLoading, error } = useQuery({
        queryKey: ['medical-record', recordId],
        queryFn: () => apiService.getMedicalRecord(recordId!),
        enabled: !!recordId,
    });

    const updateMutation = useMutation({
        mutationFn: (data: any) => apiService.updateMedicalRecord(recordId!, data),
        onSuccess: () => {
            // Optimistic update handled by local state mostly
        }
    });

    // Local state for autosave
    const [headerValues, setHeaderValues] = useState<Record<string, any>>({});
    const [workspaceData, setWorkspaceData] = useState<any>({});
    const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (record) {
            setHeaderValues(record.header_values || {});
            setWorkspaceData(record.workspace_data || {});
        }
    }, [record]);

    const triggerAutosave = (newHeaderValues?: any, newWorkspaceData?: any) => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

        const h = newHeaderValues || headerValues;
        const w = newWorkspaceData || workspaceData;

        saveTimerRef.current = setTimeout(() => {
            updateMutation.mutate({
                header_values: h,
                workspace_data: w
            });
        }, 2000); // 2 second debounce
    };

    if (isLoading) return <LoadingSpinner size="xl" center />;
    if (error || !record) return <div className="p-8 text-center text-red-500">無法開啟病歷</div>;

    return (
        <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
            {/* Header / Toolbar */}
            <div className="flex justify-between items-center bg-white px-6 py-3 border-b border-gray-200 shadow-sm z-30">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate(`/admin/clinic/patients/${record.patient_id}`)}
                        className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                    >
                        <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div>
                        <h1 className="text-lg font-bold text-gray-900 leading-tight">臨床紀錄：{record.patient_id} (Patient ID)</h1>
                        <p className="text-xs text-gray-500">
                            {record.created_at ? moment(record.created_at).format('YYYY-MM-DD') : ''} |
                            最後儲存：{updateMutation.isPending ? '儲存中...' : moment(record.updated_at).fromNow()}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex bg-gray-100 p-1 rounded-lg">
                        <button className="px-4 py-1.5 rounded-md text-sm font-medium bg-white shadow-sm text-gray-900">
                            筆記
                        </button>
                        <button className="px-4 py-1.5 rounded-md text-sm font-medium text-gray-500 hover:text-gray-700">
                            歷史
                        </button>
                    </div>
                    <Button variant="primary" size="sm" onClick={() => updateMutation.mutate({ header_values: headerValues, workspace_data: workspaceData })}>
                        完成並歸檔
                    </Button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Left Side: Structured Header */}
                <div className="w-80 bg-white border-r border-gray-200 flex flex-col shadow-inner overflow-y-auto">
                    <div className="p-6 space-y-6">
                        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">個案基本欄位</h3>

                        {record.header_structure?.map((field: any) => (
                            <div key={field.id} className="space-y-1.5">
                                <label className="text-sm font-semibold text-gray-700 block">
                                    {field.label}
                                    {field.required && <span className="text-red-500 ml-0.5">*</span>}
                                </label>

                                {field.type === 'text' && (
                                    <input
                                        type="text"
                                        value={headerValues[field.id] || ''}
                                        onChange={(e) => {
                                            const newValues = { ...headerValues, [field.id]: e.target.value };
                                            setHeaderValues(newValues);
                                            triggerAutosave(newValues);
                                        }}
                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                                    />
                                )}

                                {field.type === 'number' && (
                                    <input
                                        type="number"
                                        value={headerValues[field.id] || ''}
                                        onChange={(e) => {
                                            const newValues = { ...headerValues, [field.id]: e.target.value };
                                            setHeaderValues(newValues);
                                            triggerAutosave(newValues);
                                        }}
                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                                    />
                                )}

                                {field.type === 'select' && (
                                    <select
                                        value={headerValues[field.id] || ''}
                                        onChange={(e) => {
                                            const newValues = { ...headerValues, [field.id]: e.target.value };
                                            setHeaderValues(newValues);
                                            triggerAutosave(newValues);
                                        }}
                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none transition-all bg-white"
                                    >
                                        <option value="">請選擇...</option>
                                        {field.options?.map((opt: string) => (
                                            <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                    </select>
                                )}

                                {field.type === 'date' && (
                                    <input
                                        type="date"
                                        value={headerValues[field.id] || ''}
                                        onChange={(e) => {
                                            const newValues = { ...headerValues, [field.id]: e.target.value };
                                            setHeaderValues(newValues);
                                            triggerAutosave(newValues);
                                        }}
                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                                    />
                                )}
                            </div>
                        ))}

                        {(!record.header_structure || record.header_structure.length === 0) && (
                            <p className="text-sm text-gray-400 italic">無設定表頭欄位</p>
                        )}
                    </div>
                </div>

                {/* Main: Clinical Workspace */}
                <div className="flex-1 flex flex-col bg-gray-100 relative overflow-hidden">
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-white p-1 rounded-2xl shadow-xl border border-gray-100">
                        <button className="p-2.5 rounded-xl bg-primary-50 text-primary-600 transition-colors">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                        </button>
                        <button className="p-2.5 rounded-xl text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                        <div className="w-px h-6 bg-gray-100 mx-1"></div>
                        <button className="p-2.5 rounded-xl text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                        </button>
                    </div>

                    <div className="flex-1 flex items-center justify-center p-8 overflow-auto">
                        <div className="bg-white shadow-2xl relative aspect-[3/4] w-full max-w-4xl min-h-[800px] pointer-events-auto">
                            {/* Base Layers */}
                            <div className="absolute inset-0 z-0">
                                {record.workspace_config?.base_layers?.map((layer: any) => (
                                    <img
                                        key={layer.id}
                                        src={layer.url}
                                        alt=""
                                        className="absolute inset-0 w-full h-full object-contain pointer-events-none opacity-50"
                                    />
                                ))}
                            </div>

                            {/* Canvas / Drawing Area (Interactive) */}
                            <div className="absolute inset-0 z-10 cursor-crosshair">
                                {/* SVG Drawing Layer */}
                                <svg className="w-full h-full">
                                    {workspaceData.drawing_layers?.[0]?.paths.map((path: any, idx: number) => (
                                        <polyline
                                            key={idx}
                                            points={path.points.map((p: any) => `${p.x},${p.y}`).join(' ')}
                                            fill="none"
                                            stroke={path.color}
                                            strokeWidth={path.width}
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                    ))}
                                </svg>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MedicalRecordWorkspacePage;
