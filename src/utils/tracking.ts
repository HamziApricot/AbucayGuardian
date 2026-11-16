export interface TrackingStatus {
    isActive: boolean;
    label: string;          // "Active" | "Inactive" | "No Signal"
    timeAgo: string;        // "Active now" | "15m ago" | "2h ago" | "3d ago" | "No location"
    inactiveDuration: string; // "Active now" | "Inactive for 15m" | "Inactive for 2h" | "Never shared location"
    color: string;          // '#22C55E' (green) | '#F59E0B' (amber) | '#94A3B8' (gray)
    fromAgo: string;        // "from just now" | "from 15m ago" | "from 2h ago" | "no location"
}

/**
 * Formats a timestamp into an intuitive "from ... ago" string.
 * Example: "from just now", "from 5m ago", "from 2h ago", "from 1d ago"
 */
export function formatFromAgo(updatedAt?: string | null): string {
    if (!updatedAt) return 'from unknown time';
    const updatedDate = new Date(updatedAt);
    const now = new Date();
    const diffMs = now.getTime() - updatedDate.getTime();
    if (isNaN(diffMs)) return 'from unknown time';
    if (diffMs < 0 || diffMs < 60000) return 'from just now';

    const diffMin = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMin < 60) return `from ${diffMin}m ago`;
    if (diffHours < 24) return `from ${diffHours}h ago`;
    return `from ${diffDays}d ago`;
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
            fromAgo: 'no location',
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
            fromAgo: 'from unknown time',
        };
    }

    // If timestamp is slightly in the future due to clock skew, treat as active now
    if (diffMs < 0 || diffMs < 60000) {
        return {
            isActive: true,
            label: 'Active',
            timeAgo: 'Active now',
            inactiveDuration: 'Active now',
            color: '#22C55E',
            fromAgo: 'from just now',
        };
    }

    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    let timeAgo = '';
    let duration = '';
    let fromAgo = '';

    if (diffMin < 60) {
        duration = `${diffMin}m`;
        timeAgo = `${diffMin}m ago`;
        fromAgo = `from ${diffMin}m ago`;
    } else if (diffHours < 24) {
        const remainingMin = diffMin % 60;
        duration = remainingMin > 0 ? `${diffHours}h ${remainingMin}m` : `${diffHours}h`;
        timeAgo = `${diffHours}h ago`;
        fromAgo = `from ${diffHours}h ago`;
    } else {
        duration = `${diffDays}d`;
        timeAgo = `${diffDays}d ago`;
        fromAgo = `from ${diffDays}d ago`;
    }

    // Active threshold: updated within the last 5 minutes (Active now)
    if (diffMin < 5) {
        return {
            isActive: true,
            label: 'Active',
            timeAgo: 'Active now',
            inactiveDuration: 'Active now',
            color: '#22C55E',
            fromAgo: fromAgo || 'from just now',
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
            fromAgo,
        };
    }

    return {
        isActive: false,
        label: 'Inactive',
        timeAgo,
        inactiveDuration: `Inactive for ${duration}`,
        color: diffHours < 1 ? '#F59E0B' : '#94A3B8',
        fromAgo,
    };
}

