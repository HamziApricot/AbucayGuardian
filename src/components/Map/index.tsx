import React, { forwardRef } from 'react';
import MapView, { Marker, Circle, Polyline, Callout, UrlTile } from 'react-native-maps';

export { Marker, Circle, Polyline, Callout, UrlTile };

const MapViewWrapper = forwardRef((props: any, ref: any) => {
    return <MapView ref={ref} {...props} />;
});

export default MapViewWrapper;
