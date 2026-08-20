import codecs
import re

with codecs.open('js/app.js', 'r', 'utf-8') as f:
    lines = f.readlines()

start_idx = -1
for i, line in enumerate(lines):
    if 'container.innerHTML = \'\';' in line and 'if (settings.compact) {' in lines[i+2]:
        start_idx = i
        break

end_idx = -1
if start_idx != -1:
    for i in range(start_idx, len(lines)):
        if 'container.appendChild(wDiv);' in lines[i]:
            # The loop closes 2 lines after this
            end_idx = i + 2
            break

if start_idx != -1 and end_idx != -1:
    new_code = """            let htmlStr = '';

            if (settings.compact) {
                container.classList.add('space-y-2');
                container.classList.remove('space-y-4');
            } else {
                container.classList.add('space-y-4');
                container.classList.remove('space-y-2');
            }

            settings.order.forEach(widgetId => {
                if (settings.hidden && settings.hidden.includes(widgetId)) {
                    return;
                }

                let widgetHTML = '';
                switch(widgetId) {
                    case 'smartRecommendation':
                        widgetHTML = renderWidgetSmartRecommendation(settings.compact);
                        break;
                    case 'examCountdown':
                        widgetHTML = renderWidgetExamCountdown(settings.compact);
                        break;
                    case 'readinessScore':
                        widgetHTML = renderWidgetReadinessScore(settings.compact);
                        break;
                    case 'dailyTarget':
                        widgetHTML = renderWidgetDailyTarget(settings.compact);
                        break;
                    case 'accuracy':
                        widgetHTML = renderWidgetAccuracy(settings.compact);
                        break;
                    case 'streak':
                        widgetHTML = renderWidgetStreak(settings.compact);
                        break;
                    case 'bookmarks':
                        widgetHTML = renderWidgetBookmarks(settings.compact);
                        break;
                    case 'syllabusProgress':
                        widgetHTML = renderWidgetSyllabusProgress(settings.compact);
                        break;
                    case 'weeklyProgress':
                        widgetHTML = renderWidgetWeeklyProgress(settings.compact);
                        break;
                    case 'motivationalQuote':
                        widgetHTML = renderWidgetMotivationalQuote(settings.compact);
                        break;
                    case 'quickPractice':
                        widgetHTML = renderWidgetQuickPractice(settings.compact);
                        break;
                    case 'spacedReview':
                        widgetHTML = renderWidgetSpacedReview(settings.compact);
                        break;
                    case 'reviewMistakes':
                        widgetHTML = renderWidgetReviewMistakes(settings.compact);
                        break;
                    case 'mockTest':
                        widgetHTML = renderWidgetMockTest(settings.compact);
                        break;
                }

                if (widgetHTML) {
                    htmlStr += `<div class="slide-up-card ${settings.compact ? 'p-0.5' : ''}">${widgetHTML}</div>`;
                }
            });
            
            if (container.innerHTML !== htmlStr) {
                container.innerHTML = htmlStr;
            }\n"""
    
    lines = lines[:start_idx] + [new_code] + lines[end_idx+1:]
    with codecs.open('js/app.js', 'w', 'utf-8') as f:
        f.writelines(lines)
    print('Success')
else:
    print('Could not find bounds', start_idx, end_idx)
