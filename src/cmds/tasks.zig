const std = @import("std");
const git = @import("git.zig");
const c = git.c;

pub const help =
    \\usage: git tasks <command> [options]
    \\
    \\Task management for git repositories.
    \\
    \\Commands:
    \\  add <content>           Add a new task
    \\  list                    List all tasks
    \\  show <id>               Show task details
    \\  done <id>               Mark task as complete
    \\  ready                   List tasks ready to work on (no blockers)
    \\  pr                      Export tasks as markdown for PR description
    \\
    \\Options:
    \\  --after <id>           Add task dependency (use with 'add')
    \\  --json                 Output in JSON format
    \\  -h, --help             Show this help message
    \\
    \\Examples:
    \\  git tasks add "Fix authentication bug"
    \\  git tasks add "Add tests" --after task-001
    \\  git tasks list
    \\  git tasks show task-001
    \\  git tasks done task-001
    \\  git tasks ready
    \\  git tasks pr
    \\
;

pub const Error = git.Error || error{
    InvalidCommand,
    MissingTaskContent,
    InvalidTaskId,
    TaskNotFound,
};

pub fn run(allocator: std.mem.Allocator, args: [][:0]u8) Error!void {
    const stdout = std.fs.File.stdout().deprecatedWriter();

    if (args.len < 3) {
        stdout.print("{s}", .{help}) catch {};
        return;
    }

    const subcommand = std.mem.sliceTo(args[2], 0);

    // Handle help flags
    if (std.mem.eql(u8, subcommand, "-h") or std.mem.eql(u8, subcommand, "--help")) {
        stdout.print("{s}", .{help}) catch {};
        return;
    }

    // Initialize libgit2
    if (c.git_libgit2_init() < 0) {
        return git.Error.InitFailed;
    }
    defer _ = c.git_libgit2_shutdown();

    // Open repository
    var repo: ?*c.git_repository = null;
    if (c.git_repository_open_ext(&repo, ".", 0, null) < 0) {
        return git.Error.NotARepository;
    }
    defer c.git_repository_free(repo);

    // Route to subcommands
    if (std.mem.eql(u8, subcommand, "add")) {
        try runAdd(allocator, args, repo);
    } else if (std.mem.eql(u8, subcommand, "list")) {
        try runList(allocator, args, repo);
    } else if (std.mem.eql(u8, subcommand, "show")) {
        try runShow(allocator, args, repo);
    } else if (std.mem.eql(u8, subcommand, "done")) {
        try runDone(allocator, args, repo);
    } else if (std.mem.eql(u8, subcommand, "ready")) {
        try runReady(allocator, args, repo);
    } else if (std.mem.eql(u8, subcommand, "pr")) {
        try runPr(allocator, args, repo);
    } else {
        stdout.print("error: unknown command '{s}'\n\n{s}", .{ subcommand, help }) catch {};
        return Error.InvalidCommand;
    }
}

fn runAdd(allocator: std.mem.Allocator, args: [][:0]u8, repo: ?*c.git_repository) Error!void {
    _ = allocator;
    _ = args;
    _ = repo;

    const stdout = std.fs.File.stdout().deprecatedWriter();
    stdout.print("tasks add: not implemented yet\n", .{}) catch {};
}

fn runList(allocator: std.mem.Allocator, args: [][:0]u8, repo: ?*c.git_repository) Error!void {
    _ = allocator;
    _ = args;
    _ = repo;

    const stdout = std.fs.File.stdout().deprecatedWriter();
    stdout.print("tasks list: not implemented yet\n", .{}) catch {};
}

fn runShow(allocator: std.mem.Allocator, args: [][:0]u8, repo: ?*c.git_repository) Error!void {
    _ = allocator;
    _ = args;
    _ = repo;

    const stdout = std.fs.File.stdout().deprecatedWriter();
    stdout.print("tasks show: not implemented yet\n", .{}) catch {};
}

fn runDone(allocator: std.mem.Allocator, args: [][:0]u8, repo: ?*c.git_repository) Error!void {
    _ = allocator;
    _ = args;
    _ = repo;

    const stdout = std.fs.File.stdout().deprecatedWriter();
    stdout.print("tasks done: not implemented yet\n", .{}) catch {};
}

fn runReady(allocator: std.mem.Allocator, args: [][:0]u8, repo: ?*c.git_repository) Error!void {
    _ = allocator;
    _ = args;
    _ = repo;

    const stdout = std.fs.File.stdout().deprecatedWriter();
    stdout.print("tasks ready: not implemented yet\n", .{}) catch {};
}

fn runPr(allocator: std.mem.Allocator, args: [][:0]u8, repo: ?*c.git_repository) Error!void {
    _ = allocator;
    _ = args;
    _ = repo;

    const stdout = std.fs.File.stdout().deprecatedWriter();
    stdout.print("tasks pr: not implemented yet\n", .{}) catch {};
}