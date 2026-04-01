import { logger } from "../../lib/logger";
import { getAsyncStoreInstance as __rw_getAsyncStoreInstance } from "@cedarjs/context/dist/store";
const __rw_handler = async (event, context) => {
  logger.info('Invoked x function');
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      data: 'x function'
    })
  };
};
export const handler = async (__rw_event, __rw__context) => {
  // The store will be undefined if no context isolation has been performed yet
  const __rw_contextStore = __rw_getAsyncStoreInstance().getStore();
  if (__rw_contextStore === undefined) {
    return __rw_getAsyncStoreInstance().run(new Map(), __rw_handler, __rw_event, __rw__context);
  }
  return __rw_handler(__rw_event, __rw__context);
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJsb2dnZXIiLCJnZXRBc3luY1N0b3JlSW5zdGFuY2UiLCJfX3J3X2dldEFzeW5jU3RvcmVJbnN0YW5jZSIsIl9fcndfaGFuZGxlciIsImV2ZW50IiwiY29udGV4dCIsImluZm8iLCJzdGF0dXNDb2RlIiwiaGVhZGVycyIsImJvZHkiLCJKU09OIiwic3RyaW5naWZ5IiwiZGF0YSIsImhhbmRsZXIiLCJfX3J3X2V2ZW50IiwiX19yd19fY29udGV4dCIsIl9fcndfY29udGV4dFN0b3JlIiwiZ2V0U3RvcmUiLCJ1bmRlZmluZWQiLCJydW4iLCJNYXAiXSwic291cmNlcyI6WyJ4LmpzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGxvZ2dlciB9IGZyb20gJ3NyYy9saWIvbG9nZ2VyJ1xuXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChldmVudCwgY29udGV4dCkgPT4ge1xuICBsb2dnZXIuaW5mbygnSW52b2tlZCB4IGZ1bmN0aW9uJylcblxuICByZXR1cm4ge1xuICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICBoZWFkZXJzOiB7XG4gICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgIH0sXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgZGF0YTogJ3ggZnVuY3Rpb24nLFxuICAgIH0pLFxuICB9XG59XG4iXSwibWFwcGluZ3MiOiJBQUFBLFNBQVNBLE1BQU07QUFBd0IsU0FBQUMscUJBQUEsSUFBQUMsMEJBQUE7QUFBQSxNQUFBQyxZQUFBLEdBRWhCLE1BQUFBLENBQU9DLEtBQUssRUFBRUMsT0FBTyxLQUFLO0VBQy9DTCxNQUFNLENBQUNNLElBQUksQ0FBQyxvQkFBb0IsQ0FBQztFQUVqQyxPQUFPO0lBQ0xDLFVBQVUsRUFBRSxHQUFHO0lBQ2ZDLE9BQU8sRUFBRTtNQUNQLGNBQWMsRUFBRTtJQUNsQixDQUFDO0lBQ0RDLElBQUksRUFBRUMsSUFBSSxDQUFDQyxTQUFTLENBQUM7TUFDbkJDLElBQUksRUFBRTtJQUNSLENBQUM7RUFDSCxDQUFDO0FBQ0gsQ0FBQztBQVpELE9BQU8sTUFBTUMsT0FBTyxTQUFBQSxDQUFBQyxVQUFBLEVBQUFDLGFBQUE7RUFBQTtFQUFBLE1BQUFDLGlCQUFBLEdBQUFkLDBCQUFBLEdBQUFlLFFBQUE7RUFBQSxJQUFBRCxpQkFBQSxLQUFBRSxTQUFBO0lBQUEsT0FBQWhCLDBCQUFBLEdBQUFpQixHQUFBLEtBQUFDLEdBQUEsSUFBQWpCLFlBQUEsRUFBQVcsVUFBQSxFQUFBQyxhQUFBO0VBQUE7RUFBQSxPQUFBWixZQUFBLENBQUFXLFVBQUEsRUFBQUMsYUFBQTtBQUFBLENBWW5CIiwiaWdub3JlTGlzdCI6W119