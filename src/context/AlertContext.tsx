import React, { createContext, useContext, useState, useCallback } from 'react';

type AlertType = 'info' | 'success' | 'warning' | 'error';

interface AlertOptions {
    title: string;
    message: string;
    type?: AlertType;
    buttons?: Array<{
        text: string;
        onPress?: () => void;
        style?: 'default' | 'cancel' | 'destructive';
    }>;
}

interface ToastOptions {
    message: string;
    type?: AlertType;
    duration?: number;
}

interface AlertContextData {
    showAlert: (options: AlertOptions) => void;
    showToast: (options: ToastOptions) => void;
    hideAlert: () => void;
    alert: AlertOptions | null;
    toast: ToastOptions | null;
}

const AlertContext = createContext<AlertContextData>({} as AlertContextData);

export const AlertProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [alert, setAlert] = useState<AlertOptions | null>(null);
    const [toast, setToast] = useState<ToastOptions | null>(null);

    const showAlert = useCallback((options: AlertOptions) => {
        setAlert(options);
    }, []);

    const showToast = useCallback((options: ToastOptions) => {
        setToast(options);
        const duration = options.duration || 3000;
        setTimeout(() => {
            setToast(null);
        }, duration);
    }, []);

    const hideAlert = useCallback(() => {
        setAlert(null);
    }, []);

    return (
        <AlertContext.Provider value={{ showAlert, showToast, hideAlert, alert, toast }}>
            {children}
        </AlertContext.Provider>
    );
};

export const useAlert = () => useContext(AlertContext);
