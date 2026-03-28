#!/usr/bin/expect

set projectPath $env(PROJECT_PATH)

if {$projectPath eq ""} {
    puts "PROJECT_PATH is not set"
    exit
}

cd $projectPath

set projectDirectory "cedar-app-prompt-m-test"

spawn yarn create-cedar-app --no-install -m "first"

expect "Where would you like to create your CedarJS app?"
send "$projectDirectory\n"

expect "Select your preferred language"
# ❯ TypeScript
send "\n"

# TODO: Re-enable this once --pm flag is no longer hidden
# expect "Select your preferred package manager"
# # ❯ yarn
# send "\n"

expect "Do you want to initialize a git repo?"
# ❯ Yes
send "\n"

expect eof
catch wait result
set exitStatus [lindex $result 3]

if {$exitStatus == 0} {
    puts "Success"
    exec rm -rf $projectDirectory
    exit 0
} else {
    puts "Error: The process failed with exit status $exitStatus"
    exec rm -rf $projectDirectory
    exit 1
}
