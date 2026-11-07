export interface TrackingStatus {
    isActive: boolean;
    label: string;          // "Active" | "Inactive" | "No Signal"
    timeAgo: string;        // "Active now" | "15m ago" | "2h ago" | "3d ago" | "No location"
    inactiveDuration: string; // "Active now" | "Inactive for 15m" | "Inactive for 2h" | "Never shared location"
    color: string;          // '#22C55E' (green) | '#F59E0B' (amber) | '#94A3B8' (gray)
}

/**
 * Calculates whether a family member's tracking is active (updated within 5 minutes)
 * and formats the duration of inactivity.
 */
export function getTrackingStatus(updatedAt?: string | null, hasCoordinates: boolean = true): TrackingStatus {
    if (!hasCoordinates || !updatedAt) {
        return {
            isActive: false,
            label: 'No Signal',
            timeAgo: 'No signal',
            inactiveDuration: 'Never shared location',
            color: '#94A3B8',
        };
    }

    const updatedDate = new Date(updatedAt);
    const now = new Date();
    const diffMs = now.getTime() - updatedDate.getTime();

    // If timestamp is invalid (NaN)
    if (isNaN(diffMs)) {
        return {
            isActive: false,
            label: 'No Signal',
            timeAgo: 'Unknown',
            inactiveDuration: 'Unknown',
            color: '#94A3B8',
        };
    }

    // If timestamp is slightly in the future due to clock skew, treat as active now
    if (diffMs < 0) {
        return {
            isActive: true,
            label: 'Active',
            timeAgo: 'Active now',
            inactiveDuration: 'Active now',
            color: '#22C55E',
        };
    }

    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    // Active threshold: updated within the last 5 minutes (Active now)
    if (diffMin < 5) {
        return {
            isActive: true,
            label: 'Active',
            timeAgo: 'Active now',
            inactiveDuration: 'Active now',
            color: '#22C55E',
        };
    }

    // Stationary threshold: updated within 5 to 15 minutes.
    // Devices that are stationary or in background mode remain fully ACTIVE.
    if (diffMin < 15) {
        return {
            isActive: true,
            label: 'Active',
            timeAgo: `${diffMin}m ago`,
            inactiveDuration: 'Active (Stationary)',
            color: '#22C55E',
        };
    }

    let timeAgo = '';
    let duration = '';

    if (diffMin < 60) {
        duration = `${diffMin}m`;
        timeAgo = `${diffMin}m ago`;
    } else if (diffHours < 24) {
        const remainingMin = diffMin % 60;
        duration = remainingMin > 0 ? `${diffHours}h ${remainingMin}m` : `${diffHours}h`;
        timeAgo = `${diffHours}h ago`;
    } else {
        duration = `${diffDays}d`;
        timeAgo = `${diffDays}d ago`;
    }

    return {
        isActive: false,
        label: 'Inactive',
        timeAgo,
        inactiveDuration: `Inactive for ${duration}`,
        color: diffHours < 1 ? '#F59E0B' : '#94A3B8',
    };
}

