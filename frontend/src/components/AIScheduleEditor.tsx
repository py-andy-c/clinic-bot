import React from 'react';
import { useFormContext, useFieldArray, Controller } from 'react-hook-form';
import { TimeInput } from './shared/TimeInput';

const DAYS_OF_WEEK = [
    { key: 'mon', label: '星期一' },
    { key: 'tue', label: '星期二' },
    { key: 'wed', label: '星期三' },
    { key: 'thu', label: '星期四' },
    { key: 'fri', label: '星期五' },
    { key: 'sat', label: '星期六' },
    { key: 'sun', label: '星期日' },
] as const;

interface DayScheduleProps {
    dayKey: typeof DAYS_OF_WEEK[number]['key'];
    label: string;
    disabled?: boolean;
}

const DaySchedule: React.FC<DayScheduleProps> = ({ dayKey, label, disabled = false }) => {
    const { control } = useFormContext();
    const { fields, append, remove } = useFieldArray({
        control,
        name: `chat_settings.ai_reply_schedule.${dayKey}`,
    });

    return (
        <div className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
            <div className="flex justify-between items-center mb-3">
                <h4 className="font-medium text-gray-900">{label}</h4>
                <button
                    type="button"
                    onClick={() => append({ start_time: '09:00', end_time: '18:00' })}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50 font-medium"
                >
                    + 新增時段
                </button>
            </div>

            {fields.length === 0 ? (
                <p className="text-gray-400 text-sm italic">本日 AI 不工作</p>
            ) : (
                <div className="space-y-3">
                    {fields.map((field, index) => (
                        <div key={field.id} className="flex items-center space-x-3 bg-gray-50 p-3 rounded-md group transition-colors hover:bg-gray-100">
                            <div className="grid grid-cols-2 gap-4 flex-1">
                                <div>
                                    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">開始</label>
                                    <Controller
                                        control={control}
                                        name={`chat_settings.ai_reply_schedule.${dayKey}.${index}.start_time`}
                                        render={({ field: { value, onChange } }) => (
                                            <TimeInput
                                                value={value}
                                                onChange={onChange}
                                                disabled={disabled}
                                                className="w-full shadow-sm"
                                            />
                                        )}
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">結束</label>
                                    <Controller
                                        control={control}
                                        name={`chat_settings.ai_reply_schedule.${dayKey}.${index}.end_time`}
                                        render={({ field: { value, onChange } }) => (
                                            <TimeInput
                                                value={value}
                                                onChange={onChange}
                                                disabled={disabled}
                                                className="w-full shadow-sm"
                                            />
                                        )}
                                    />
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => remove(index)}
                                disabled={disabled}
                                className="text-gray-400 hover:text-red-500 p-1.5 transition-colors rounded-md hover:bg-red-50 disabled:opacity-30"
                                title="移除時段"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

interface AIScheduleEditorProps {
    disabled?: boolean;
}

const AIScheduleEditor: React.FC<AIScheduleEditorProps> = ({ disabled = false }) => {
    return (
        <div className="mt-4 space-y-4">
            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
                <div className="flex">
                    <div className="flex-shrink-0">
                        <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                    </div>
                    <div className="ml-3">
                        <p className="text-sm text-blue-700">
                            設定 AI 客服的運作時間。在非設定時段內，AI 將不會自動回覆訊息。<b>若今日未設定任何時段，則 AI 今日將不會回覆。</b>
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {DAYS_OF_WEEK.map((day) => (
                    <DaySchedule
                        key={day.key}
                        dayKey={day.key}
                        label={day.label}
                        disabled={disabled}
                    />
                ))}
            </div>
        </div>
    );
};

export default AIScheduleEditor;
