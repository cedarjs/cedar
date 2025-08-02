// Test job file for cedarjsJobPathInjectorPlugin functionality
// This module uses jobs.createJob which should have path and name injected

export const testJob = {
  queue: 'default',
  perform: function(data) {
    return {
      success: true,
      data: data
    }
  }
}

export const anotherTestJob = {
  queue: 'high-priority',
  perform: function(params) {
    return {
      userId: params.userId,
      action: params.action,
      completed: true
    }
  }
}

export const simpleJob = {}
