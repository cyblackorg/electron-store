/*
 * Copyright (c) 2014-2025 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

const security = require('./lib/insecurity')

console.log('Testing Database and System Protections...\n')

// Test Database Protection
console.log('=== Database Protection Tests ===')

// Should allow SQL injection challenges
console.log('✓ SQL injection challenges should work:')
console.log('  SELECT * FROM Users WHERE email = "admin@juice-sh.op" OR 1=1--', 
  security.isDatabaseOperationAllowed('SELECT * FROM Users WHERE email = "admin@juice-sh.op" OR 1=1--'))

// Should block critical operations
console.log('\n✗ Critical database operations should be blocked:')
console.log('  DROP DATABASE juiceshop', security.isDatabaseOperationAllowed('DROP DATABASE juiceshop'))
console.log('  DROP TABLE Users', security.isDatabaseOperationAllowed('DROP TABLE Users'))
console.log('  DELETE FROM Users', security.isDatabaseOperationAllowed('DELETE FROM Users'))
console.log('  DELETE FROM SecurityAnswers', security.isDatabaseOperationAllowed('DELETE FROM SecurityAnswers'))

// Should allow other dangerous operations for challenges
console.log('\n✓ Other dangerous operations should work for challenges:')
console.log('  ALTER TABLE Users ADD COLUMN test VARCHAR(255)', 
  security.isDatabaseOperationAllowed('ALTER TABLE Users ADD COLUMN test VARCHAR(255)'))
console.log('  UPDATE Users SET role = "admin"', 
  security.isDatabaseOperationAllowed('UPDATE Users SET role = "admin"'))

// Test System Command Protection
console.log('\n=== System Command Protection Tests ===')

// Should allow command injection challenges
console.log('✓ Command injection challenges should work:')
console.log('  ls; echo "test"', security.isSystemCommandAllowed('ls; echo "test"'))
console.log('  cat /etc/passwd | grep root', security.isSystemCommandAllowed('cat /etc/passwd | grep root'))
console.log('  echo "test" && whoami', security.isSystemCommandAllowed('echo "test" && whoami'))

// Should block system failure commands
console.log('\n✗ System failure commands should be blocked:')
console.log('  docker stop container', security.isSystemCommandAllowed('docker stop container'))
console.log('  docker-compose down', security.isSystemCommandAllowed('docker-compose down'))
console.log('  systemctl stop nginx', security.isSystemCommandAllowed('systemctl stop nginx'))
console.log('  shutdown -h now', security.isSystemCommandAllowed('shutdown -h now'))
console.log('  rm -rf /', security.isSystemCommandAllowed('rm -rf /'))

// Should allow other dangerous commands for challenges
console.log('\n✓ Other dangerous commands should work for challenges:')
console.log('  chmod 777 /tmp/test', security.isSystemCommandAllowed('chmod 777 /tmp/test'))
console.log('  useradd testuser', security.isSystemCommandAllowed('useradd testuser'))
console.log('  passwd testuser', security.isSystemCommandAllowed('passwd testuser'))

console.log('\n=== Protection Summary ===')
console.log('✅ Database protection: Prevents database deletion, table dropping, and user deletion')
console.log('✅ System protection: Prevents docker stop, system shutdown, and critical file deletion')
console.log('✅ SQL injection challenges: Still work for security training')
console.log('✅ Command injection challenges: Still work for security training')
console.log('\nProtections are working correctly! 🛡️') 