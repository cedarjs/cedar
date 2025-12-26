// Test job file for cedarjsJobPathInjectorPlugin functionality
// This module uses jobs.createJob which should have path and name injected

import { jobs } from 'src/lib/jobs.js'

export const testJob = jobs.createJob({
  queue: 'default',
  perform: function(data) {
    return {
      success: true,
      data: data
    }
  }
})

export const anotherTestJob = jobs.createJob({
  queue: 'high-priority',
  perform: function(params) {
    return {
      userId: params.userId,
      action: params.action,
      completed: true
    }
  }
})

export const simpleJob = jobs.createJob({
  queue: 'low-priority',
  perform: function(params) {
    console.log('Simple job executed')
  }
})
