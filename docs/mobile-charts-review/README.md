# Mobile charts: before / after

Before images use the original chart implementation and CSS from main at `ac42d97520f553b8fcf7a080f373ddf0f4d31e7c`, the merge of PR #76. After images use Task 6. Both receive identical deterministic hourly data, including negative temperatures and 0.2 rainfall. No live weather/account services are used.

The adjacent `index.html` provides an offline selector for all four charts, these two representative viewport/language/theme combinations, and no selection / the final hour. Download the directory together to open it locally. Automated coverage additionally checks every requested viewport in both languages and themes.

| 320px · Bulgarian · light · final hour | Before | After |
| --- | --- | --- |
| Temperature | ![Original temperature](320-0-last-before.png) | ![Improved temperature](320-0-last-after.png) |
| Precipitation | ![Original precipitation](320-1-last-before.png) | ![Improved precipitation](320-1-last-after.png) |
| Wind | ![Original wind](320-2-last-before.png) | ![Improved wind](320-2-last-after.png) |
| Pressure | ![Original pressure](320-3-last-before.png) | ![Improved pressure](320-3-last-after.png) |

| 640px · English · dark · final hour | Before | After |
| --- | --- | --- |
| Temperature | ![Original temperature](640-0-last-before.png) | ![Improved temperature](640-0-last-after.png) |
| Precipitation | ![Original precipitation](640-1-last-before.png) | ![Improved precipitation](640-1-last-after.png) |
| Wind | ![Original wind](640-2-last-before.png) | ![Improved wind](640-2-last-after.png) |
| Pressure | ![Original pressure](640-3-last-before.png) | ![Improved pressure](640-3-last-after.png) |

The English summaries and “Now” are intentional language corrections, also applied on desktop. Existing values, decimal formatting and units are retained.
