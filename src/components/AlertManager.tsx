import React from 'react';
import { CustomAlert } from './CustomAlert';
import { CustomToast } from './CustomToast';

export const AlertManager = () => {
    return (
        <>
            <CustomAlert />
            <CustomToast />
        </>
    );
};
