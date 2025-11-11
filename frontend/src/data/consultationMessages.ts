/**
 * Consultation message data for different clinic types.
 * These messages demonstrate value-based health consultations that ask for
 * additional information and provide tailored advice.
 */

export type ClinicType = '物理治療' | '醫美' | '牙醫';

export interface Message {
  sender: 'user' | 'bot';
  text: string;
  time?: string;
}

export interface ConsultationMessages {
  [key: string]: Message[];
}

export const consultationMessages: ConsultationMessages = {
  物理治療: [
    { sender: 'user', text: '我最近肩膀很痛，特別是舉手的時候，這是什麼問題？', time: '14:30' },
    { sender: 'bot', text: '根據您的描述，可能是肩關節相關的問題。常見原因包括：\n\n• 肩夾擠症候群\n• 旋轉肌袖損傷\n• 五十肩（冰凍肩）\n\n為了給您更準確的建議，想了解幾個問題：\n\n1. 疼痛持續多久了？\n2. 是突然發生還是逐漸加劇？\n3. 除了舉手，還有其他動作會痛嗎？\n4. 是否有受過傷或過度使用？', time: '14:31' },
    { sender: 'user', text: '大概兩個禮拜了，是慢慢變痛的。除了舉手，側睡壓到也會痛。沒有受傷，但最近工作比較忙，常需要舉手做事。', time: '14:32' },
    { sender: 'bot', text: '謝謝您提供的資訊！根據您的描述：\n\n📋 可能原因分析：\n• 持續兩週的漸進式疼痛，加上工作相關的過度使用，較可能是「肩夾擠症候群」或「旋轉肌袖肌腱炎」\n• 側睡壓痛表示可能有發炎或組織受壓\n\n💡 建議的自我照護方式：\n• 暫時減少或調整會引起疼痛的動作\n• 工作時注意姿勢，避免長時間舉手\n• 側睡時可嘗試在手臂下墊小枕頭減壓\n• 輕微的肩部伸展（在不痛的範圍內）\n\n如果疼痛持續或加劇，建議尋求專業評估以確定診斷並制定治療計畫。需要我幫您安排評估時間嗎？', time: '14:33' },
  ],
  醫美: [
    { sender: 'user', text: '我想了解除皺針的效果和安全性', time: '14:30' },
    { sender: 'bot', text: '除皺針（肉毒桿菌素）是安全且有效的醫美療程。\n\n✨ 效果：\n• 減少動態皺紋\n• 效果可維持3-6個月\n• 自然不僵硬\n\n✅ 安全性：\n• FDA認證\n• 專業醫師施打\n• 副作用極少\n\n適合改善抬頭紋、魚尾紋、皺眉紋等。想了解適合您的療程嗎？', time: '14:31' },
    { sender: 'user', text: '會有副作用嗎？', time: '14:32' },
    { sender: 'bot', text: '除皺針的副作用非常少見且輕微：\n\n• 注射部位輕微紅腫（數小時內消退）\n• 極少數可能出現暫時性頭痛\n• 罕見的過敏反應\n\n我們的醫師會在療程前進行詳細諮詢，確保您適合施打。有任何疑慮都可以隨時詢問！', time: '14:33' },
  ],
  牙醫: [
    { sender: 'user', text: '我的牙齒最近對冷熱很敏感，這是什麼原因？', time: '14:30' },
    { sender: 'bot', text: '牙齒敏感可能的原因包括：\n\n🦷 常見原因：\n• 牙齦萎縮導致牙根暴露\n• 琺瑯質磨損\n• 蛀牙\n• 牙齒裂痕\n\n為了更準確判斷，想了解：\n\n1. 敏感是最近才開始的嗎？大概多久了？\n2. 是特定幾顆牙齒還是多顆都有？\n3. 冷、熱、甜食或刷牙時哪個最敏感？\n4. 最近有改變刷牙方式或使用新牙膏嗎？', time: '14:31' },
    { sender: 'user', text: '大概一個月了，主要是門牙和旁邊幾顆。冷的最敏感，刷牙時也會有點不舒服。最近換了比較硬的牙刷。', time: '14:32' },
    { sender: 'bot', text: '根據您提供的資訊：\n\n📋 可能原因分析：\n• 換用硬牙刷可能造成琺瑯質磨損或牙齦萎縮\n• 門牙區域敏感，加上刷牙不適，較可能是牙齦萎縮導致牙根暴露\n• 冷敏感是典型的牙本質敏感症狀\n\n💡 建議的改善方式：\n• 立即改用軟毛牙刷，並採用正確的刷牙方式（避免過度用力）\n• 使用抗敏感牙膏，每天使用2次，持續2-4週可見效果\n• 避免過冷過熱的食物，讓牙齒有適應時間\n• 使用含氟漱口水，有助於強化琺瑯質\n\n如果症狀持續或加劇，建議安排檢查以排除蛀牙或其他問題。需要我幫您預約檢查時間嗎？', time: '14:33' },
  ],
};

