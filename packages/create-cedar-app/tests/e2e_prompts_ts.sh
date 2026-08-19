#!/usr/bin/expect

set projectPath $env(PROJECT_PATH)

if {$projectPath eq ""} {
    puts "PROJECT_PATH is not set"
    exit
}

cd $projectPath

set projectDirectory "redwood-app-prompt-ts-test"

spawn yarn create-cedar-app --no-install --ts

expect "Where would you like to create your CedarJS app?"
send "$projectDirectory\n"

# TODO: Re-enable this once --pm flag is no longer hidden
# expect "Select your preferred package manager"
# # ❯ yarn
# send "\n"

expect "Do you want to initialize a git repo?"
# ❯ Yes
send "\n"

expect "Enter a commit message"
# Initial commit
send "\n"

expect eof
catch wait result
set exitStatus [lindex $result 3]

# Git can still be finishing work in .git/objects right after the generator exits,
# so wait briefly and treat cleanup as best-effort to avoid flaky local and CI runs.
after 500
catch {exec rm -rf $projectDirectory}

if {$exitStatus == 0} {
    puts "Success"
    exit 0
} else {
    puts "Error: The process failed with exit status $exitStatus"
    exit 1
}
