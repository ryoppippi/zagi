const std = @import("std");

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    // Get command line arguments
    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);

    // If no arguments provided (just the program name), show usage
    if (args.len < 2) {
        const stderr = std.io.getStdErr().writer();
        try stderr.print("usage: zagi <git-command> [args...]\n", .{});
        try stderr.print("\nzagi is a git wrapper that passes commands through to git.\n", .{});
        try stderr.print("Special commands:\n", .{});
        try stderr.print("  diff - Uses difftastic for syntax-aware diffs, shows one file at a time\n", .{});
        std.process.exit(1);
    }

    // Check if this is the special "diff" command
    if (std.mem.eql(u8, args[1], "diff")) {
        try handleDiffCommand(allocator, args);
        return;
    }

    // For all other commands, pass through to git
    try passThrough(allocator, args);
}

fn handleDiffCommand(allocator: std.mem.Allocator, args: [][]const u8) !void {
    const stdout = std.io.getStdOut().writer();
    const stderr = std.io.getStdErr().writer();

    // Check if difftastic is installed
    const difftastic_check = std.process.Child.init(&[_][]const u8{ "which", "difft" }, allocator);
    const difft_available = blk: {
        var check_child = difftastic_check;
        check_child.stdout_behavior = .Ignore;
        check_child.stderr_behavior = .Ignore;
        const term = check_child.spawnAndWait() catch break :blk false;
        break :blk switch (term) {
            .Exited => |code| code == 0,
            else => false,
        };
    };

    // If difftastic is not available, fall back to regular git diff
    if (!difft_available) {
        try stderr.print("⚠️  difftastic not found, falling back to git diff\n", .{});
        try stderr.print("💡 Install difftastic for better diffs:\n", .{});
        try stderr.print("   • macOS:   brew install difftastic\n", .{});
        try stderr.print("   • Linux:   cargo install difftastic\n", .{});
        try stderr.print("   • Arch:    pacman -S difftastic\n\n", .{});
        try passThrough(allocator, args);
        return;
    }

    // First, get the list of changed files
    var git_files_args = std.ArrayList([]const u8).init(allocator);
    defer git_files_args.deinit();
    
    try git_files_args.append("git");
    try git_files_args.append("diff");
    try git_files_args.append("--name-only");
    
    // Add user's additional arguments (excluding file paths for now)
    for (args[2..]) |arg| {
        if (!std.mem.startsWith(u8, arg, "--")) {
            // Skip positional arguments for the file list query
            continue;
        }
        try git_files_args.append(arg);
    }

    var git_files_child = std.process.Child.init(git_files_args.items, allocator);
    git_files_child.stdout_behavior = .Pipe;
    git_files_child.stderr_behavior = .Inherit;
    
    try git_files_child.spawn();
    
    const files_output = try git_files_child.stdout.?.readToEndAlloc(allocator, 10 * 1024 * 1024);
    defer allocator.free(files_output);
    
    _ = try git_files_child.wait();

    // Parse the files list
    var changed_files = std.ArrayList([]const u8).init(allocator);
    defer changed_files.deinit();
    
    var file_iter = std.mem.split(u8, files_output, "\n");
    while (file_iter.next()) |file| {
        if (file.len > 0) {
            try changed_files.append(file);
        }
    }

    if (changed_files.items.len == 0) {
        try stdout.print("No changes to diff\n", .{});
        return;
    }

    // Determine which file to show (first one by default)
    const file_to_show = changed_files.items[0];

    // Build git diff command for the specific file
    var git_args = std.ArrayList([]const u8).init(allocator);
    defer git_args.deinit();
    
    try git_args.append("git");
    try git_args.append("diff");
    
    // Add user's additional arguments
    for (args[2..]) |arg| {
        try git_args.append(arg);
    }
    
    // Add the specific file
    try git_args.append("--");
    try git_args.append(file_to_show);

    // Get the diff output from git
    var git_child = std.process.Child.init(git_args.items, allocator);
    git_child.stdout_behavior = .Pipe;
    git_child.stderr_behavior = .Inherit;
    
    try git_child.spawn();
    
    const git_output = try git_child.stdout.?.readToEndAlloc(allocator, 100 * 1024 * 1024);
    defer allocator.free(git_output);
    
    _ = try git_child.wait();

    if (git_output.len == 0) {
        try stdout.print("No changes in {s}\n", .{file_to_show});
        return;
    }

    // Build difftastic command
    var difft_args = std.ArrayList([]const u8).init(allocator);
    defer difft_args.deinit();

    try difft_args.append("difft");
    try difft_args.append("--color=always");
    try difft_args.append("--display=inline");

    // Run difftastic on the git output
    var difft_child = std.process.Child.init(difft_args.items, allocator);
    difft_child.stdin_behavior = .Pipe;
    difft_child.stdout_behavior = .Inherit;
    difft_child.stderr_behavior = .Inherit;
    
    try difft_child.spawn();
    
    // Write git output to difftastic stdin
    try difft_child.stdin.?.writeAll(git_output);
    difft_child.stdin.?.close();
    difft_child.stdin = null;
    
    const term = try difft_child.wait();
    
    // Check if difftastic succeeded
    const success = switch (term) {
        .Exited => |code| code == 0,
        else => false,
    };

    if (!success) {
        try stderr.print("\n⚠️  difftastic failed, falling back to git diff\n", .{});
        try passThrough(allocator, args);
        return;
    }

    // Show recipe command if there are more files
    if (changed_files.items.len > 1) {
        try stdout.print("\n", .{});
        try stdout.print("{'─'}{s}{'─'}\n", .{"─" ** 78});
        try stdout.print("📁 Showing file 1 of {d}: {s}\n", .{ changed_files.items.len, file_to_show });
        try stdout.print("\n📝 Recipe: To see the next file, run:\n", .{});
        try stdout.print("   zagi diff", .{});
        for (args[2..]) |arg| {
            try stdout.print(" {s}", .{arg});
        }
        try stdout.print(" -- {s}\n", .{changed_files.items[1]});
        
        try stdout.print("\n📋 All changed files:\n", .{});
        for (changed_files.items, 0..) |file, i| {
            const marker = if (i == 0) "→" else " ";
            try stdout.print("   {s} {s}\n", .{ marker, file });
        }
        
        try stdout.print("\n💡 Or see all files at once with:\n", .{});
        try stdout.print("   git diff", .{});
        for (args[2..]) |arg| {
            try stdout.print(" {s}", .{arg});
        }
        try stdout.print("\n", .{});
    } else {
        try stdout.print("\n✅ Showing the only changed file: {s}\n", .{file_to_show});
    }
}

fn passThrough(allocator: std.mem.Allocator, args: [][]const u8) !void {
    const stderr = std.io.getStdErr().writer();
    
    // Prepare arguments for git (skip our program name, prepend "git")
    var git_args = std.ArrayList([]const u8).init(allocator);
    defer git_args.deinit();

    try git_args.append("git");
    for (args[1..]) |arg| {
        try git_args.append(arg);
    }

    // Execute git command as a child process
    var child = std.process.Child.init(git_args.items, allocator);
    
    // Inherit stdin, stdout, and stderr so git can interact with the terminal
    child.stdin_behavior = .Inherit;
    child.stdout_behavior = .Inherit;
    child.stderr_behavior = .Inherit;

    // Spawn and wait for the child process
    const term = child.spawnAndWait() catch |err| {
        try stderr.print("Error executing git: {s}\n", .{@errorName(err)});
        std.process.exit(1);
    };

    // Exit with the same code as git
    switch (term) {
        .Exited => |code| std.process.exit(code),
        .Signal => |sig| {
            try stderr.print("Git process terminated by signal {d}\n", .{sig});
            std.process.exit(1);
        },
        .Stopped => |sig| {
            try stderr.print("Git process stopped by signal {d}\n", .{sig});
            std.process.exit(1);
        },
        .Unknown => |code| {
            try stderr.print("Git process exited with unknown status {d}\n", .{code});
            std.process.exit(1);
        },
    }
}
