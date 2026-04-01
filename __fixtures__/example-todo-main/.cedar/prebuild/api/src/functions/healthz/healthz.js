import { logger } from "../../lib/logger";
import { getAsyncStoreInstance as __rw_getAsyncStoreInstance } from "@cedarjs/context/dist/store";
const __rw_handler = async (event, context) => {
  logger.info('Invoked healtz function');
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      data: 'healthz function'
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJsb2dnZXIiLCJnZXRBc3luY1N0b3JlSW5zdGFuY2UiLCJfX3J3X2dldEFzeW5jU3RvcmVJbnN0YW5jZSIsIl9fcndfaGFuZGxlciIsImV2ZW50IiwiY29udGV4dCIsImluZm8iLCJzdGF0dXNDb2RlIiwiaGVhZGVycyIsImJvZHkiLCJKU09OIiwic3RyaW5naWZ5IiwiZGF0YSIsImhhbmRsZXIiLCJfX3J3X2V2ZW50IiwiX19yd19fY29udGV4dCIsIl9fcndfY29udGV4dFN0b3JlIiwiZ2V0U3RvcmUiLCJ1bmRlZmluZWQiLCJydW4iLCJNYXAiXSwic291cmNlcyI6WyJoZWFsdGh6LmpzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGxvZ2dlciB9IGZyb20gJ3NyYy9saWIvbG9nZ2VyJ1xuXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChldmVudCwgY29udGV4dCkgPT4ge1xuICBsb2dnZXIuaW5mbygnSW52b2tlZCBoZWFsdHogZnVuY3Rpb24nKVxuXG4gIHJldHVybiB7XG4gICAgc3RhdHVzQ29kZTogMjAwLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgfSxcbiAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICBkYXRhOiAnaGVhbHRoeiBmdW5jdGlvbicsXG4gICAgfSksXG4gIH1cbn1cbiJdLCJtYXBwaW5ncyI6IkFBQUEsU0FBU0EsTUFBTTtBQUF3QixTQUFBQyxxQkFBQSxJQUFBQywwQkFBQTtBQUFBLE1BQUFDLFlBQUEsR0FFaEIsTUFBQUEsQ0FBT0MsS0FBSyxFQUFFQyxPQUFPLEtBQUs7RUFDL0NMLE1BQU0sQ0FBQ00sSUFBSSxDQUFDLHlCQUF5QixDQUFDO0VBRXRDLE9BQU87SUFDTEMsVUFBVSxFQUFFLEdBQUc7SUFDZkMsT0FBTyxFQUFFO01BQ1AsY0FBYyxFQUFFO0lBQ2xCLENBQUM7SUFDREMsSUFBSSxFQUFFQyxJQUFJLENBQUNDLFNBQVMsQ0FBQztNQUNuQkMsSUFBSSxFQUFFO0lBQ1IsQ0FBQztFQUNILENBQUM7QUFDSCxDQUFDO0FBWkQsT0FBTyxNQUFNQyxPQUFPLFNBQUFBLENBQUFDLFVBQUEsRUFBQUMsYUFBQTtFQUFBO0VBQUEsTUFBQUMsaUJBQUEsR0FBQWQsMEJBQUEsR0FBQWUsUUFBQTtFQUFBLElBQUFELGlCQUFBLEtBQUFFLFNBQUE7SUFBQSxPQUFBaEIsMEJBQUEsR0FBQWlCLEdBQUEsS0FBQUMsR0FBQSxJQUFBakIsWUFBQSxFQUFBVyxVQUFBLEVBQUFDLGFBQUE7RUFBQTtFQUFBLE9BQUFaLFlBQUEsQ0FBQVcsVUFBQSxFQUFBQyxhQUFBO0FBQUEsQ0FZbkIiLCJpZ25vcmVMaXN0IjpbXX0=