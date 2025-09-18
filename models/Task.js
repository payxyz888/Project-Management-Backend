// models/Task.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Task = sequelize.define('Task', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
      validate: {
        len: [1, 200],
        notEmpty: true
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    status_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'project_statuses',
        key: 'id'
      }
    },
    position: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    priority: {
      type: DataTypes.ENUM('low', 'medium', 'high'),
      defaultValue: 'medium',
      allowNull: false
    },
    projectId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'project_id'
    },
    assignedTo: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'assigned_to'
    },
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'created_by'
    },
    dueDate: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'due_date'
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'completed_at'
    }
  }, {
    tableName: 'tasks',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    hooks: {
      // Automatically set completedAt when status changes to completed
      beforeUpdate: (task) => {
        if (task.changed('status')) {
          if (task.status === 'completed' && task._previousDataValues.status !== 'completed') {
            task.completedAt = new Date();
          } else if (task.status !== 'completed') {
            task.completedAt = null;
          }
        }
      }
    }
  });

  // Instance methods
  Task.prototype.markCompleted = async function() {
    this.status = 'completed';
    this.completedAt = new Date();
    return await this.save();
  };

  Task.prototype.markInProgress = async function() {
    this.status = 'in-progress';
    this.completedAt = null;
    return await this.save();
  };

  Task.prototype.markTodo = async function() {
    this.status = 'todo';
    this.completedAt = null;
    return await this.save();
  };

  Task.prototype.assignTo = async function(userId) {
    this.assignedTo = userId;
    return await this.save();
  };

  Task.prototype.isOverdue = function() {
    if (!this.dueDate) return false;
    return new Date() > new Date(this.dueDate) && this.status !== 'completed';
  };

  // Class methods
  Task.findByProject = async function(projectId, options = {}) {
    return await this.findAll({
      where: { projectId },
      include: [
        {
          model: sequelize.models.User,
          as: 'assignee',
          attributes: ['id', 'username', 'email']
        },
        {
          model: sequelize.models.User,
          as: 'creator',
          attributes: ['id', 'username', 'email']
        }
      ],
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  Task.findByStatus = async function(status, projectId = null) {
    const where = { status };
    if (projectId) where.projectId = projectId;

    return await this.findAll({
      where,
      include: [
        {
          model: sequelize.models.User,
          as: 'assignee',
          attributes: ['id', 'username', 'email']
        },
        {
          model: sequelize.models.Project,
          as: 'project',
          attributes: ['id', 'name']
        }
      ]
    });
  };

  Task.findOverdue = async function(projectId = null) {
    const where = {
      dueDate: { [sequelize.Sequelize.Op.lt]: new Date() },
      status: { [sequelize.Sequelize.Op.ne]: 'completed' }
    };
    if (projectId) where.projectId = projectId;

    return await this.findAll({
      where,
      include: [
        {
          model: sequelize.models.User,
          as: 'assignee',
          attributes: ['id', 'username', 'email']
        },
        {
          model: sequelize.models.Project,
          as: 'project',
          attributes: ['id', 'name']
        }
      ]
    });
  };

  return Task;
};