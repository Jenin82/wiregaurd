# Changelog

## [2.0.0] - 2024-10-27

### 🎯 Major Improvements - Fixes for Hanging and Delayed Logs

This release addresses critical issues with action hangs and delayed logging in long-running workflows.

### ✨ New Features

- **Real-time Output Streaming**: All command execution now uses output listeners to stream logs immediately instead of buffering
- **Timeout Protection**: Added configurable timeouts for all long-running operations
- **DNS Retry Logic**: Automatic retry with exponential backoff for failed DNS resolutions
- **Progress Indicators**: Visual progress tracking with `[X/Y]` counters for domains and IPs
- **Enhanced Logging**: Emoji-enhanced logs with clear status indicators (✓, ✗, ⚠️)
- **Execution Timing**: Total execution time logged at completion
- **Better Error Diagnostics**: Improved error messages with diagnostic information gathering

### 🔧 Technical Changes

#### Timeout Configuration
- DNS resolution: 10 seconds per lookup (3 retry attempts with 2s delay)
- WireGuard interface startup: 60 seconds
- Route addition: 10 seconds per route
- Interface check: 5 seconds

#### Output Buffering Fix
All `exec.exec()` calls now include real-time listeners:
```typescript
listeners: {
    stdout: (data: Buffer) => process.stdout.write(data),
    stderr: (data: Buffer) => process.stderr.write(data)
}
```

#### DNS Resolution Improvements
- Automatic retry on failure (up to 3 attempts)
- 10-second timeout per resolution attempt
- Graceful handling of partial failures (IPv4 or IPv6 only)
- Detailed logging of resolution results

#### Error Handling
- Wrapped all long-running operations with timeout protection
- Added diagnostic information gathering on failures
- Better error context in failure messages
- Stack traces available in debug mode

### 📝 Documentation

- Added comprehensive troubleshooting section to README
- Documented timeout configurations
- Added guidance for common hang scenarios
- Included performance tips for long-running workflows

### 🐛 Bug Fixes

- Fixed output buffering causing delayed logs
- Fixed indefinite hangs on DNS resolution failures
- Fixed lack of feedback during long operations
- Fixed missing error context in failure messages

### 🔄 Breaking Changes

None - this release is backward compatible with v1.x

### 📊 Performance

- Faster failure detection (operations fail fast instead of hanging)
- More efficient DNS resolution with parallel IPv4/IPv6 lookups
- Better resource usage with timeout protection

### 🙏 Acknowledgments

Issues addressed:
- Action hanging in long-running workflows
- Delayed log output making action appear frozen
- DNS resolution timeouts
- Lack of progress feedback

---

## [1.0.0] - Previous Release

Initial release with basic WireGuard setup and dynamic routing capabilities.
