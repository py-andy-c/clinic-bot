

export const TestimonialSection = () => {
    return (
        <section className="bg-gradient-to-br from-primary-50 to-white py-24 border-y border-primary-100">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex flex-col-reverse lg:flex-row items-center gap-12 lg:gap-20">
                    <div className="lg:w-1/3">
                        <div className="aspect-[4/5] bg-primary-100 rounded-2xl overflow-hidden shadow-xl relative border border-primary-200">
                            <img
                                src="/images/therapist_02.webp"
                                alt="羅士倫 院長"
                                className="w-full h-full object-cover"
                            />
                        </div>
                        <div className="mt-6 text-center lg:text-left">
                            <h3 className="text-2xl font-bold text-gray-900">羅士倫 院長</h3>
                            <div className="mt-2 flex justify-center lg:justify-start">
                                <img src="/images/toss_logo_title.webp" alt="Toss Logo" className="h-8 object-contain opacity-80" />
                            </div>
                        </div>
                    </div>
                    <div className="lg:w-2/3">
                        <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-6 leading-tight">
                            讓醫療回歸專業，把瑣事交給數位助理
                        </h2>
                        <p className="text-xl text-primary-800 italic mb-10 border-l-4 border-primary-500 pl-6 py-4 bg-white/60 rounded-r-lg shadow-sm">
                            「我們以為只是回覆慢了一點，卻沒發現每個月都在流失治癒大家的機會。」
                        </p>
                        <div className="space-y-6 text-lg text-gray-700 leading-relaxed">
                            <p>
                                羅院長坦言，診所營運穩定後，最大的挑戰往往不是醫療技術，而是龐雜的「行政瑣事」。當治療師忙到不可開交，預約漏接、忙中忘記關懷就成了常態，這也間接影響了病患對診所的整體印象。
                            </p>
                            <p>
                                導入系統後，這些經營缺口被一一補齊。
                                <strong className="text-primary-900 bg-white px-2 py-0.5 mx-1 rounded shadow-sm ring-1 ring-primary-100">自動預約提醒大幅降低了爽約率</strong>；
                                <strong className="text-primary-900 bg-white px-2 py-0.5 mx-1 rounded shadow-sm ring-1 ring-primary-100">AI 24小時待命，接手新客諮詢</strong>；
                                <strong className="text-primary-900 bg-white px-2 py-0.5 mx-1 rounded shadow-sm ring-1 ring-primary-100">診後自動追蹤，讓服務能延伸到診間之外</strong>。
                            </p>
                            <p>
                                「現在系統幫我們守住細節，團隊能更專注在提供高品質的醫療服務。」
                            </p>
                        </div>

                        <div className="mt-12 flex flex-col sm:flex-row gap-6">
                            <div className="bg-white p-6 rounded-xl shadow-md border border-primary-100 flex-1 hover:shadow-lg transition-shadow">
                                <div className="text-4xl font-bold text-primary-600 mb-2">90%</div>
                                <div className="text-gray-600 font-medium">節省行政時間</div>
                            </div>
                            <div className="bg-white p-6 rounded-xl shadow-md border border-primary-100 flex-1 hover:shadow-lg transition-shadow">
                                <div className="text-4xl font-bold text-primary-600 mb-2">3X</div>
                                <div className="text-gray-600 font-medium">新客預約轉換率</div>
                            </div>
                            <div className="bg-white p-6 rounded-xl shadow-md border border-primary-100 flex-1 hover:shadow-lg transition-shadow">
                                <div className="text-4xl font-bold text-primary-600 mb-2">0%</div>
                                <div className="text-gray-600 font-medium">預約無故未到率</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};
