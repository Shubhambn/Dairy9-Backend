// controllers/superadmin.logs.controller.js
import SuperAdmin from '../models/superadmin.model.js';

// Get Action Logs
export const getActionLogs = async (req, res) => {
  try {
    console.log('📋 [LOGS] Starting get action logs request');
    
    // Use req.user instead of req.superadmin
    if (!req.user) {
      console.error('❌ [LOGS] req.user is undefined!');
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    console.log('✅ [LOGS] Authenticated user:', {
      id: req.user._id,
      phone: req.user.phone,
      role: req.user.role
    });

    const { 
      page = 1, 
      limit = 20, 
      action = '',
      resource = '',
      startDate,
      endDate,
      sortBy = 'timestamp',
      sortOrder = 'desc'
    } = req.query;

    console.log('📋 [LOGS] Query params:', { page, limit, action, resource });

    // Since we're using User model, we need to find the SuperAdmin by phone
    const superadmin = await SuperAdmin.findOne({ mobile: req.user.phone });
    
    if (!superadmin) {
      console.log('❌ [LOGS] No SuperAdmin record found for phone:', req.user.phone);
      return res.json({
        success: true,
        data: {
          logs: [],
          pagination: {
            current: 1,
            total: 0,
            count: 0,
            totalRecords: 0
          },
          statistics: {
            total: 0,
            byAction: {},
            byResource: {},
            byDate: {}
          }
        }
      });
    }

    // Get filtered logs
    let logs = superadmin.actionLogs || [];
    
    // Apply filters
    if (action) {
      logs = logs.filter(log => 
        log.action?.toLowerCase().includes(action.toLowerCase())
      );
    }
    
    if (resource) {
      logs = logs.filter(log => 
        log.resource?.toLowerCase().includes(resource.toLowerCase())
      );
    }

    // Apply date filter
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate) : new Date(0);
      const end = endDate ? new Date(endDate) : new Date();
      end.setHours(23, 59, 59, 999);

      logs = logs.filter(log => {
        const logDate = new Date(log.timestamp);
        return logDate >= start && logDate <= end;
      });
    }

    // Sort logs
    logs.sort((a, b) => {
      const aValue = a[sortBy];
      const bValue = b[sortBy];
      
      if (sortOrder === 'desc') {
        return new Date(bValue) - new Date(aValue);
      } else {
        return new Date(aValue) - new Date(bValue);
      }
    });

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedLogs = logs.slice(startIndex, endIndex);

    // Get log statistics
    const logStats = {
      total: logs.length,
      byAction: {},
      byResource: {},
      byDate: {}
    };

    logs.forEach(log => {
      // Count by action
      logStats.byAction[log.action] = (logStats.byAction[log.action] || 0) + 1;
      
      // Count by resource
      logStats.byResource[log.resource] = (logStats.byResource[log.resource] || 0) + 1;
      
      // Count by date
      const dateKey = new Date(log.timestamp).toISOString().split('T')[0];
      logStats.byDate[dateKey] = (logStats.byDate[dateKey] || 0) + 1;
    });

    // Log this action using console.log
    console.log('📋 [LOGS] SuperAdmin viewed action logs:', {
      userId: req.user._id,
      page,
      actionFilter: action,
      resourceFilter: resource,
      results: paginatedLogs.length
    });

    res.json({
      success: true,
      data: {
        logs: paginatedLogs,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(logs.length / limit),
          count: paginatedLogs.length,
          totalRecords: logs.length
        },
        statistics: logStats
      }
    });

  } catch (error) {
    console.error('❌ [LOGS] Get action logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch action logs',
      error: error.message
    });
  }
};

// Clear Old Logs
export const clearOldLogs = async (req, res) => {
  try {
    console.log('🗑️ [LOGS] Starting clear old logs request');
    
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const { olderThanDays = 30 } = req.body;

    // Find SuperAdmin by user phone
    const superadmin = await SuperAdmin.findOne({ mobile: req.user.phone });
    
    if (!superadmin) {
      return res.status(404).json({
        success: false,
        message: 'SuperAdmin record not found'
      });
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(olderThanDays));

    const initialCount = superadmin.actionLogs?.length || 0;
    
    // Filter out logs older than cutoff date
    superadmin.actionLogs = (superadmin.actionLogs || []).filter(
      log => new Date(log.timestamp) >= cutoffDate
    );

    const finalCount = superadmin.actionLogs.length;
    const deletedCount = initialCount - finalCount;

    await superadmin.save();

    // Log using console.log
    console.log('🗑️ [LOGS] SuperAdmin cleared old logs:', {
      userId: req.user._id,
      olderThanDays,
      deletedCount,
      remainingCount: finalCount
    });

    res.json({
      success: true,
      message: `Cleared ${deletedCount} logs older than ${olderThanDays} days`,
      data: {
        deletedCount,
        remainingCount: finalCount
      }
    });

  } catch (error) {
    console.error('❌ [LOGS] Clear old logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear old logs',
      error: error.message
    });
  }
};

// Export Logs
export const exportLogs = async (req, res) => {
  try {
    console.log('📤 [LOGS] Starting export logs request');
    
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const { format = 'json', startDate, endDate } = req.query;

    // Find SuperAdmin by user phone
    const superadmin = await SuperAdmin.findOne({ mobile: req.user.phone });
    
    if (!superadmin) {
      return res.status(404).json({
        success: false,
        message: 'SuperAdmin record not found'
      });
    }

    let logs = superadmin.actionLogs || [];

    // Apply date filter if provided
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate) : new Date(0);
      const end = endDate ? new Date(endDate) : new Date();
      end.setHours(23, 59, 59, 999);

      logs = logs.filter(log => {
        const logDate = new Date(log.timestamp);
        return logDate >= start && logDate <= end;
      });
    }

    // Sort by timestamp (newest first)
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    let exportData;
    let filename;
    let contentType;

    switch (format) {
      case 'csv':
        exportData = convertToCSV(logs);
        filename = `action_logs_${new Date().toISOString().split('T')[0]}.csv`;
        contentType = 'text/csv';
        break;
      
      case 'json':
      default:
        exportData = JSON.stringify(logs, null, 2);
        filename = `action_logs_${new Date().toISOString().split('T')[0]}.json`;
        contentType = 'application/json';
        break;
    }

    // Log using console.log
    console.log('📤 [LOGS] SuperAdmin exported logs:', {
      userId: req.user._id,
      format,
      recordCount: logs.length
    });

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(exportData);

  } catch (error) {
    console.error('❌ [LOGS] Export logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export logs',
      error: error.message
    });
  }
};

// Helper function to convert logs to CSV
const convertToCSV = (logs) => {
  const headers = ['Timestamp', 'Action', 'Resource', 'Resource ID', 'IP Address', 'User Agent', 'Details'];
  
  const csvRows = [
    headers.join(','), // Header row
    ...logs.map(log => [
      `"${new Date(log.timestamp).toISOString()}"`,
      `"${log.action || ''}"`,
      `"${log.resource || ''}"`,
      `"${log.resourceId || ''}"`,
      `"${log.ipAddress || ''}"`,
      `"${(log.userAgent || '').replace(/"/g, '""')}"`,
      `"${JSON.stringify(log.details || {}).replace(/"/g, '""')}"`
    ].join(','))
  ];
  
  return csvRows.join('\n');
};