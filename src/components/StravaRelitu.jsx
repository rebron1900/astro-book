// src/components/StravaRelitu.jsx

function parseDate(str) {
    return new Date(str);
}

function getThisSunday(date) {
    const dayOfWeek = date.getDay();
    const daysToSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    const thisSunday = new Date(date);
    thisSunday.setDate(thisSunday.getDate() + daysToSunday);
    return thisSunday;
}

function dateBuild(activities, today) {
    const activityCounts = {};
    const activityDetails = {};

    activities.forEach((activity) => {
        // Handle both ISO format (2024-03-12T07:05:55) and space format (2024-03-12 07:05:55)
        const dateStr = activity.start_date_local.split(' ')[0].split('T')[0];
        activityCounts[dateStr] = (activityCounts[dateStr] || 0) + 1;

        if (!activityDetails[dateStr]) {
            activityDetails[dateStr] = [];
        }

        // Convert moving_time to seconds if it's a string
        let movingTimeSeconds = 0;
        if (typeof activity.moving_time === 'string') {
            const parts = activity.moving_time.split(':');
            if (parts.length === 3) {
                movingTimeSeconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
            } else if (parts.length === 2) {
                movingTimeSeconds = parseInt(parts[0]) * 60 + parseInt(parts[1]);
            }
        } else {
            movingTimeSeconds = activity.moving_time;
        }

        activityDetails[dateStr].push({
            name: activity.name,
            distance: activity.distance,
            moving_time: movingTimeSeconds,
            type: activity.type,
            start_date: activity.start_date_local,
            id: activity.run_id
        });
    });

    const result = [];
    const sunday = getThisSunday(today);
    let startDate = new Date(sunday);
    startDate.setDate(sunday.getDate() - 364); // 365 days including today

    for (let currentDate = new Date(startDate); currentDate <= sunday; currentDate.setDate(currentDate.getDate() + 1)) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const count = activityCounts[dateStr] || 0;
        const activitiesOnDate = activityDetails[dateStr] || [];

        const totalDistance = activitiesOnDate.reduce((total, activity) => total + activity.distance, 0);
        const totalDuration = activitiesOnDate.reduce((total, activity) => total + activity.moving_time, 0);

        result.push({
            date: dateStr,
            count: count,
            activities: activitiesOnDate,
            totalDistance: totalDistance,
            totalDuration: totalDuration
        });
    }

    return result;
}

const DateGrid = ({ activities = [] }) => {
    const today = new Date();
    const builtData = dateBuild(activities, today);

    const columns = () => {
        const cols = [];
        const items = builtData;

        for (let i = 0; i < items.length; i += 7) {
            cols.push(items.slice(i, i + 7));
        }

        return cols;
    };

    const formatDistance = (meters) => {
        if (meters < 1000) {
            return `${Math.round(meters)}m`;
        }
        return `${(meters / 1000).toFixed(1)}km`;
    };

    const formatDuration = (seconds) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) {
            return `${hours}h${minutes}m`;
        }
        return `${minutes}m`;
    };

    return (
        <div class='toc-relitu'>
            <strong>运动热力图</strong>
            <div id='relitu-container' class='relitu-container'>
                {columns().map((column, colIndex) => (
                    <div class='grid-column' key={colIndex}>
                        {column.map((day, index) => {
                            const currentStyle = day.date === new Date().toISOString().split('T')[0] ? 'current-item' : '';

                            const tooltipActivities = day.activities
                                .map(
                                    (activity) =>
                                        `- <a href="#" class="strava-activity" data-runid="${activity.id}">${activity.name}: ${formatDistance(activity.distance)} (${formatDuration(activity.moving_time)})</a><br/>`
                                )
                                .join('');

                            const tooltipStr =
                                day.count > 0
                                    ? `${day.date}，共 ${day.count} 次运动，${formatDistance(day.totalDistance)}\u003cbr/>${tooltipActivities}`
                                    : `${day.date}，无运动记录`;

                            let intensity = 0;
                            if (day.totalDistance > 0) {
                                intensity = Math.min(day.totalDistance / 10000, 1); // 10km as max intensity
                            }

                            return (
                                <div class='grid-item' key={index}>
                                    <div
                                        role='button'
                                        title={`${day.date}，${day.count} 次运动`}
                                        style={intensity > 0 ? `background-color:rgba(255, 107, 0,${intensity * 0.8 + 0.2})` : ''}
                                        class={`item-info ${currentStyle}`}
                                        data-tippy-content={tooltipStr}
                                        data-date={day.date}
                                    />
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
            <div class='relitu-count'>
                跑跑停停，博主已记录 <strong>{activities.length}</strong> 次运动!
            </div>
        </div>
    );
};

export default DateGrid;
