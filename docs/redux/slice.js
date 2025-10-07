import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  data: [],
};

const exampleSlice = createSlice({
  name: 'example',
  initialState,
  reducers: {
    setData: (state, action) => {
      state.data = action.payload;
    },
  },
});

export const { setData } = exampleSlice.actions;
export default exampleSlice.reducer;


// In your store.js, import and add this reducer to the store
// import exampleReducer from './slice';
// ...
// reducer: {
//   example: exampleReducer,
// },
// ...
