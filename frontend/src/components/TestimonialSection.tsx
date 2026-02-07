

export const TestimonialSection = () => {
    return (
        <section className="bg-gradient-to-br from-primary-50 to-white py-24 border-y border-primary-100">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
                    <div className="lg:w-1/3">
                        <div className="aspect-[4/5] bg-primary-100 rounded-2xl overflow-hidden shadow-xl relative border border-primary-200">
                            <div className="absolute inset-0 flex items-center justify-center text-primary-400">
                                <span className="text-xl font-bold">羅士倫 院長照片</span>
                            </div>
                        </div>
                        <div className="mt-6 text-center lg:text-left">
                            <h3 className="text-2xl font-bold text-gray-900">羅士倫 院長</h3>
                            <p className="text-primary-600 font-medium mt-1">XXX 物理治療所</p>
                        </div>
                    </div>
                    <div className="lg:w-2/3">
                        <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-6 leading-tight">
                            別讓「忙碌」成為診所營收的隱形殺手
                        </h2>
                        <p className="text-xl text-primary-800 italic mb-10 border-l-4 border-primary-500 pl-6 py-4 bg-white/60 rounded-r-lg shadow-sm">
                            「我們以為只是回覆慢了一點，卻沒發現每個月都在流失好幾萬的業績。」
                        </p>
                        <div className="space-y-6 text-lg text-gray-700 leading-relaxed">
                            <p>
                                羅院長坦言，診所生意一直都不錯，但治療師們常常忙到不可開交。在忙碌中，經常發生「忘記提醒病患」導致被放鴿子空轉一小時，或是「治療中無法回訊」讓新客轉頭找別家。更可惜的是，因為沒時間做術後關懷，許多舊客就這樣默默流失了。
                            </p>
                            <p>
                                導入系統後，這些「隱形損失」被一一堵住。
                                <strong className="text-primary-900 bg-white px-2 py-0.5 mx-1 rounded shadow-sm ring-1 ring-primary-100">自動化預約提醒大幅降低了爽約率</strong>；
                                <strong className="text-primary-900 bg-white px-2 py-0.5 mx-1 rounded shadow-sm ring-1 ring-primary-100">AI 24小時待命接手新客諮詢</strong>；
                                <strong className="text-primary-900 bg-white px-2 py-0.5 mx-1 rounded shadow-sm ring-1 ring-primary-100">術後自動追蹤，不僅暖心更能留住舊客</strong>。
                            </p>
                            <p>
                                「現在即使忙碌，我們依然能精準地掌握每一位病患與每一分營收。」
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
