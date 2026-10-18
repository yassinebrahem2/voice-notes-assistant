import React from 'react';
import { Snackbar } from 'react-native-paper';

import { dismissSnackbar, useSnackbar } from './snackbarStore';

export function AppSnackbar() {
  const message = useSnackbar();

  return (
    <Snackbar
      visible={Boolean(message)}
      onDismiss={dismissSnackbar}
      duration={3000}
    >
      {message ?? ''}
    </Snackbar>
  );
}
