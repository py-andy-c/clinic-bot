/**
 * Service comparison message data for different clinic types.
 * These messages demonstrate AI-powered service recommendations and comparisons.
 */

import type { Message } from './consultationMessages';

export interface ServiceMessages {
  [key: string]: Message[];
}

export const serviceMessages: ServiceMessages = {
  物理治療: [
    { sender: 'user', text: '我想了解徒手治療和運動治療的差別？', time: '15:20' },
    { sender: 'bot', text: '兩種治療方式各有特色：\n\n👋 徒手治療：\n• 治療師直接操作，放鬆緊繃肌肉\n• 調整關節位置\n• 立即緩解疼痛\n• 適合急性期\n\n🏃 運動治療：\n• 強化肌力與穩定度\n• 改善動作模式\n• 預防復發\n• 適合恢復期\n\n通常會結合兩種方式，效果最佳！', time: '15:21' },
    { sender: 'user', text: '那我應該選哪一種？', time: '15:22' },
    { sender: 'bot', text: '建議您先來評估，我們的物理治療師會根據您的：\n\n✓ 疼痛程度\n✓ 活動受限情況\n✓ 生活需求\n✓ 恢復目標\n\n為您制定最適合的治療計畫。通常急性期會以徒手治療為主，恢復期加入運動治療。需要我幫您預約評估嗎？', time: '15:23' },
  ],
  醫美: [
    { sender: 'user', text: '我想了解音波拉提和電波拉提的差別？', time: '15:20' },
    { sender: 'bot', text: '兩種療程各有優勢：\n\n🔊 音波拉提：\n• 聚焦超音波，深層加熱\n• 適合改善輪廓線\n• 效果較明顯\n• 適合中重度鬆弛\n\n⚡ 電波拉提：\n• 全面性加熱\n• 適合改善膚質\n• 緊緻效果溫和\n• 適合輕中度鬆弛\n\n可以根據您的需求選擇，或結合兩種療程效果更佳！', time: '15:21' },
    { sender: 'user', text: '哪一個比較適合我？', time: '15:22' },
    { sender: 'bot', text: '建議您先來諮詢，我們的醫師會根據您的：\n\n✓ 肌膚狀況\n✓ 鬆弛程度\n✓ 預算考量\n✓ 期望效果\n\n為您推薦最適合的療程。也可以安排體驗，讓您更清楚感受效果。需要我幫您預約諮詢嗎？', time: '15:23' },
  ],
  牙醫: [
    { sender: 'user', text: '我想了解傳統矯正和隱適美的差別？', time: '15:20' },
    { sender: 'bot', text: '兩種矯正方式各有特色：\n\n🦷 傳統矯正：\n• 金屬或陶瓷矯正器\n• 效果穩定可靠\n• 價格較親民\n• 適合複雜案例\n\n✨ 隱適美：\n• 透明牙套，美觀隱形\n• 可自行取下\n• 清潔方便\n• 適合輕中度案例\n\n醫師會根據您的狀況推薦最適合的方式！', time: '15:21' },
    { sender: 'user', text: '隱適美會比較慢嗎？', time: '15:22' },
    { sender: 'bot', text: '不一定！療程時間主要取決於：\n\n⏱️ 影響因素：\n• 牙齒移動難度\n• 配戴時間（需每天22小時）\n• 個人配合度\n\n一般來說，隱適美和傳統矯正的時間相近，約1.5-2.5年。醫師會在評估後給您預估時間。想了解您的狀況適合哪種方式嗎？', time: '15:23' },
  ],
};

