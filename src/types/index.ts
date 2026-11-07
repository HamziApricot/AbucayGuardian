export type UserProfile = {
    id: string;
    name: string;
    phone: string;
    avatar_url?: string;
    pairing_code?: string;
    lat?: number;
    lng?: number;
    updated_at?: string;
};

export type FamilyMember = {
    id: string;
    user_id: string;
    member_user_id?: string;
    name: string;
    phone: string;
    relationship: string;
    avatar_url?: string;
    lat?: number;
    lng?: number;
    accuracy?: number;
    speed?: number;
    battery?: number | null;
    heading?: number | null;
    updated_at?: string;
    member?: { avatar_url: string | null };
};

export type EmergencyPlan = {
    id: string;
    user_id: string;
    title: string;
    steps: EmergencyPlanStep[];
    created_at?: string;
    updated_at?: string;
};

export type EmergencyPlanStep = {
    id: string;
    text: string;
    completed?: boolean;
};

export type SOSEvent = {
    id: string;
    user_id: string;
    lat?: number;
    lng?: number;
    triggered_at: string;
    status: 'active' | 'cancelled' | 'resolved';
};

export type Hotline = {
    id: string;
    name: string;
    number: string;
    category: string;
    icon: string;
    color: string;
};

export type Procedure = {
    id: string;
    title: string;
    category: string;
    icon: string;
    color: string;
    steps: string[];
    summary?: string;
    doNots?: string[];
    emergencyKit?: string[];
    urgentCall?: {
        name: string;
        number: string;
        label?: string;
    };
};

export type TrackerLocation = {
    id: string;
    user_id: string;
    lat: number;
    lng: number;
    accuracy?: number;
    speed?: number;
    battery?: number;
    heading?: number | null;
    updated_at: string;
    user?: UserProfile;
};
