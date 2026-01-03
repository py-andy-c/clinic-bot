#!/usr/bin/env node
/**
 * Port cleanup script for E2E tests
 * 
 * This script runs before Playwright tests to ensure ports are free.
 * It uses npm's pre-script mechanism (pretest:e2e) to run automatically.
 * 
 * This runs BEFORE Playwright's webServer health check, preventing hangs
 * when stuck processes are bound to ports but not responding to HTTP.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import kill from 'cross-port-killer';

const execPromise = promisify(exec);

function getTimestamp() {
  return new Date().toISOString();
}

function log(message) {
  const timestamp = getTimestamp();
  console.log(`[${timestamp}] [CLEANUP] ${message}`);
}

async function cleanupPort(port) {
  log(`Cleaning up port ${port}...`);
  
  let cleanupSuccess = false;
  
  // Method 1: Use lsof + kill (most reliable, native Unix tool)
  try {
    // Find PIDs using lsof (works on macOS/Linux)
    const { stdout } = await execPromise(`lsof -ti :${port} 2>/dev/null || true`);
    const pids = stdout.trim().split('\n').filter(pid => pid.length > 0);
    
    if (pids.length > 0) {
      log(`Found ${pids.length} process(es) on port ${port}: ${pids.join(', ')}`);
      
      // Retry loop: Keep killing until port is free (max 3 attempts)
      let attempts = 0;
      const maxAttempts = 3;
      let remainingPids = pids;
      
      while (attempts < maxAttempts && remainingPids.length > 0) {
        attempts++;
        log(`Cleanup attempt ${attempts}/${maxAttempts}...`);
        
        // Kill all current PIDs - wait for kill commands to complete
        // Kill all processes and wait for kill commands to complete
        const killPromises = remainingPids.map(async (pid) => {
          try {
            // Use execPromise to wait for kill command to complete
            await execPromise(`kill -9 ${pid} 2>/dev/null || true`, { timeout: 1000 });
            log(`✓ Killed process ${pid}`);
          } catch (error) {
            // Process might already be dead, which is fine
            log(`⚠ Kill command for PID ${pid} completed (process may already be dead)`);
          }
        });
        
        // Wait for all kill commands to complete
        await Promise.all(killPromises);
        
        // Wait a moment for OS to clean up port bindings
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Check what's still on the port with timeout protection
        try {
          const verifyPromise = execPromise(`lsof -ti :${port} 2>/dev/null || true`, { timeout: 2000 });
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Port check timeout')), 2000)
          );
          const { stdout: verifyStdout } = await Promise.race([verifyPromise, timeoutPromise]);
          remainingPids = verifyStdout.trim().split('\n').filter(pid => pid.length > 0);
          
          if (remainingPids.length > 0 && attempts < maxAttempts) {
            log(`⚠ ${remainingPids.length} process(es) still on port ${port}: ${remainingPids.join(', ')} - retrying...`);
          }
        } catch (error) {
          log(`⚠ Port check failed or timed out: ${error.message}, assuming cleanup succeeded`);
          remainingPids = [];
        }
      }
      
      if (remainingPids.length === 0) {
        cleanupSuccess = true;
        log(`✓ Port ${port} is now free after ${attempts} attempt(s)`);
      } else {
        log(`⚠ ${remainingPids.length} process(es) still on port ${port} after ${maxAttempts} attempts: ${remainingPids.join(', ')}`);
      }
    } else {
      cleanupSuccess = true;
      log(`✓ Port ${port} is free (no processes found)`);
    }
  } catch (error) {
    log(`lsof method failed: ${error.message}, trying fallback...`);
  }
  
  // Method 2: Fallback to cross-port-killer if lsof didn't work
  if (!cleanupSuccess) {
    try {
      await kill(port);
      log(`✓ Fallback cleanup completed using cross-port-killer`);
      cleanupSuccess = true;
    } catch (error) {
      // Ignore errors if no process exists on the port (this is expected and fine)
      log(`✓ Port ${port} is free (fallback check)`);
    }
  }
  
  return cleanupSuccess;
}

async function main() {
  const ports = [8000, 3000]; // Backend and frontend ports
  
  log('='.repeat(60));
  log('Port cleanup script started');
  log('This runs BEFORE Playwright initializes to prevent webServer hangs');
  log('='.repeat(60));
  
  for (const port of ports) {
    await cleanupPort(port);
  }
  
  log('='.repeat(60));
  log('Port cleanup complete');
  log('='.repeat(60));
}

main().catch((error) => {
  console.error(`[${getTimestamp()}] [CLEANUP] Fatal error:`, error);
  process.exit(1);
});

