import { configureStore } from '@reduxjs/toolkit';

// Import your reducers here (none yet)
export const store = configureStore({
  reducer: {
    // example: user: userReducer,
  },
});



// Provide the store to your app

// src/main.jsx (if using Vite)
// or src/index.js (if using CRA)


// import React from 'react';
// import ReactDOM from 'react-dom/client';
// import { Provider } from 'react-redux';
// import { store } from './app/store';
// import App from './App';

// ReactDOM.createRoot(document.getElementById('root')).render(
//   <Provider store={store}>
//     <App />
//   </Provider>
// );
