import { logger } from "../../lib/logger";
import { getAsyncStoreInstance as __rw_getAsyncStoreInstance } from "@cedarjs/context/dist/store";
const __rw_handler = async (event, context) => {
  logger.info('Invoked nested function');
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      data: 'nested function'
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJsb2dnZXIiLCJnZXRBc3luY1N0b3JlSW5zdGFuY2UiLCJfX3J3X2dldEFzeW5jU3RvcmVJbnN0YW5jZSIsIl9fcndfaGFuZGxlciIsImV2ZW50IiwiY29udGV4dCIsImluZm8iLCJzdGF0dXNDb2RlIiwiaGVhZGVycyIsImJvZHkiLCJKU09OIiwic3RyaW5naWZ5IiwiZGF0YSIsImhhbmRsZXIiLCJfX3J3X2V2ZW50IiwiX19yd19fY29udGV4dCIsIl9fcndfY29udGV4dFN0b3JlIiwiZ2V0U3RvcmUiLCJ1bmRlZmluZWQiLCJydW4iLCJNYXAiXSwic291cmNlcyI6WyJuZXN0ZWQudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnc3JjL2xpYi9sb2dnZXInXG5cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKGV2ZW50LCBjb250ZXh0KSA9PiB7XG4gIGxvZ2dlci5pbmZvKCdJbnZva2VkIG5lc3RlZCBmdW5jdGlvbicpXG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgaGVhZGVyczoge1xuICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICB9LFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIGRhdGE6ICduZXN0ZWQgZnVuY3Rpb24nLFxuICAgIH0pLFxuICB9XG59XG4iXSwibWFwcGluZ3MiOiJBQUFBLFNBQVNBLE1BQU07QUFBd0IsU0FBQUMscUJBQUEsSUFBQUMsMEJBQUE7QUFBQSxNQUFBQyxZQUFBLEdBRWhCLE1BQUFBLENBQU9DLEtBQUssRUFBRUMsT0FBTyxLQUFLO0VBQy9DTCxNQUFNLENBQUNNLElBQUksQ0FBQyx5QkFBeUIsQ0FBQztFQUV0QyxPQUFPO0lBQ0xDLFVBQVUsRUFBRSxHQUFHO0lBQ2ZDLE9BQU8sRUFBRTtNQUNQLGNBQWMsRUFBRTtJQUNsQixDQUFDO0lBQ0RDLElBQUksRUFBRUMsSUFBSSxDQUFDQyxTQUFTLENBQUM7TUFDbkJDLElBQUksRUFBRTtJQUNSLENBQUM7RUFDSCxDQUFDO0FBQ0gsQ0FBQztBQVpELE9BQU8sTUFBTUMsT0FBTyxTQUFBQSxDQUFBQyxVQUFBLEVBQUFDLGFBQUE7RUFBQTtFQUFBLE1BQUFDLGlCQUFBLEdBQUFkLDBCQUFBLEdBQUFlLFFBQUE7RUFBQSxJQUFBRCxpQkFBQSxLQUFBRSxTQUFBO0lBQUEsT0FBQWhCLDBCQUFBLEdBQUFpQixHQUFBLEtBQUFDLEdBQUEsSUFBQWpCLFlBQUEsRUFBQVcsVUFBQSxFQUFBQyxhQUFBO0VBQUE7RUFBQSxPQUFBWixZQUFBLENBQUFXLFVBQUEsRUFBQUMsYUFBQTtBQUFBLENBWW5CIiwiaWdub3JlTGlzdCI6W119