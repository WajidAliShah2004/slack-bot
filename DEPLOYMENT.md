# Deployment Guide

This guide provides comprehensive instructions for deploying the Smart Slack Bot in various environments.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Local Development](#local-development)
4. [Docker Deployment](#docker-deployment)
5. [Kubernetes Deployment](#kubernetes-deployment)
6. [Cloud Deployment](#cloud-deployment)
7. [Monitoring & Logging](#monitoring--logging)
8. [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Software
- Node.js 18+ 
- PostgreSQL 14+
- Redis 6+
- Docker & Docker Compose
- Git

### Required Accounts & API Keys
- Slack App credentials
- Azure AD App registration
- OpenAI API key
- (Optional) Cloud provider account

## Environment Setup

### 1. Clone the Repository
```bash
git clone <repository-url>
cd slack-bot
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Configuration
```bash
cp env.example .env
# Edit .env with your actual credentials
```

### 4. Database Setup
```bash
# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# Seed database (optional)
npm run db:seed
```

## Local Development

### Quick Start
```bash
# Start all services with Docker Compose
docker-compose up -d

# Or start individual services
docker-compose up postgres redis -d
npm run dev
```

### Development Commands
```bash
# Start development server
npm run dev

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Format code
npm run format

# Database operations
npm run db:studio  # Open Prisma Studio
npm run db:migrate # Run migrations
npm run db:seed    # Seed database
```

## Docker Deployment

### 1. Build the Image
```bash
# Build production image
docker build -t smart-slack-bot .

# Or build with specific tag
docker build -t smart-slack-bot:v1.0.0 .
```

### 2. Run with Docker Compose
```bash
# Start all services
docker-compose up -d

# Start with specific profile
docker-compose --profile production up -d

# Start with monitoring
docker-compose --profile monitoring up -d

# View logs
docker-compose logs -f slack-bot
```

### 3. Environment-Specific Deployment

#### Development
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

#### Staging
```bash
docker-compose -f docker-compose.yml -f docker-compose.staging.yml up -d
```

#### Production
```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### 4. Database Migration
```bash
# Run migrations
docker-compose run --rm db-migrate

# Seed database
docker-compose run --rm db-seed
```

## Kubernetes Deployment

### 1. Prerequisites
- Kubernetes cluster (1.20+)
- kubectl configured
- Helm 3.x

### 2. Create Namespace
```bash
kubectl create namespace slack-bot
kubectl config set-context --current --namespace=slack-bot
```

### 3. Create Secrets
```bash
# Create secret for environment variables
kubectl create secret generic slack-bot-secrets \
  --from-literal=SLACK_BOT_TOKEN=your-token \
  --from-literal=SLACK_SIGNING_SECRET=your-secret \
  --from-literal=AZURE_CLIENT_ID=your-client-id \
  --from-literal=AZURE_CLIENT_SECRET=your-client-secret \
  --from-literal=AZURE_TENANT_ID=your-tenant-id \
  --from-literal=OPENAI_API_KEY=your-api-key \
  --from-literal=JWT_SECRET=your-jwt-secret
```

### 4. Deploy with Helm
```bash
# Add Helm repository (if using custom chart)
helm repo add slack-bot https://your-helm-repo.com

# Install the application
helm install slack-bot ./helm/slack-bot \
  --namespace slack-bot \
  --set environment=production \
  --set replicaCount=3
```

### 5. Deploy with kubectl
```bash
# Apply all manifests
kubectl apply -f k8s/

# Or apply individually
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
```

### 6. Scale Application
```bash
# Scale deployment
kubectl scale deployment slack-bot --replicas=5

# Auto-scaling
kubectl autoscale deployment slack-bot --cpu-percent=70 --min=2 --max=10
```

## Cloud Deployment

### AWS Deployment

#### ECS/Fargate
```bash
# Build and push to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin your-account.dkr.ecr.us-east-1.amazonaws.com
docker tag smart-slack-bot:latest your-account.dkr.ecr.us-east-1.amazonaws.com/smart-slack-bot:latest
docker push your-account.dkr.ecr.us-east-1.amazonaws.com/smart-slack-bot:latest

# Deploy with CloudFormation
aws cloudformation deploy \
  --template-file cloudformation/ecs-stack.yaml \
  --stack-name slack-bot-stack \
  --capabilities CAPABILITY_IAM
```

#### EKS
```bash
# Create EKS cluster
eksctl create cluster --name slack-bot-cluster --region us-east-1

# Deploy application
kubectl apply -f k8s/aws/
```

### Azure Deployment

#### AKS
```bash
# Create AKS cluster
az aks create --resource-group myResourceGroup --name slack-bot-cluster --node-count 3

# Deploy application
kubectl apply -f k8s/azure/
```

#### Container Instances
```bash
# Deploy to Container Instances
az container create \
  --resource-group myResourceGroup \
  --name smart-slack-bot \
  --image your-registry.azurecr.io/smart-slack-bot:latest \
  --ports 3000 \
  --environment-variables \
    NODE_ENV=production \
    DATABASE_URL=your-database-url
```

### Google Cloud Deployment

#### GKE
```bash
# Create GKE cluster
gcloud container clusters create slack-bot-cluster --num-nodes=3

# Deploy application
kubectl apply -f k8s/gcp/
```

#### Cloud Run
```bash
# Deploy to Cloud Run
gcloud run deploy smart-slack-bot \
  --image gcr.io/your-project/smart-slack-bot:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

## Monitoring & Logging

### 1. Health Checks
```bash
# Basic health check
curl http://localhost:3000/health

# Detailed health check
curl http://localhost:3000/health/detailed

# Readiness check
curl http://localhost:3000/health/ready

# Liveness check
curl http://localhost:3000/health/live
```

### 2. Metrics
```bash
# Prometheus metrics
curl http://localhost:3000/metrics

# Application metrics
curl http://localhost:3000/admin/metrics
```

### 3. Logs
```bash
# View application logs
docker-compose logs -f slack-bot

# View specific service logs
docker-compose logs -f postgres
docker-compose logs -f redis

# Kubernetes logs
kubectl logs -f deployment/slack-bot
kubectl logs -f deployment/slack-bot -c slack-bot
```

### 4. Monitoring Stack
```bash
# Start monitoring stack
docker-compose --profile monitoring up -d

# Access Grafana
open http://localhost:3001
# Default credentials: admin/admin

# Access Prometheus
open http://localhost:9090
```

## Troubleshooting

### Common Issues

#### 1. Database Connection Issues
```bash
# Check database connectivity
docker-compose exec postgres psql -U slackbot -d slackbot -c "SELECT 1;"

# Check Prisma connection
npm run db:studio
```

#### 2. Redis Connection Issues
```bash
# Check Redis connectivity
docker-compose exec redis redis-cli ping

# Check Redis logs
docker-compose logs redis
```

#### 3. Slack API Issues
```bash
# Verify Slack credentials
curl -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  https://slack.com/api/auth.test

# Check webhook signature
# Verify SLACK_SIGNING_SECRET is correct
```

#### 4. Azure AD Issues
```bash
# Verify Azure AD configuration
# Check AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID
# Ensure redirect URI is configured correctly
```

#### 5. OpenAI API Issues
```bash
# Test OpenAI API
curl -H "Authorization: Bearer $OPENAI_API_KEY" \
  https://api.openai.com/v1/models
```

### Debug Commands
```bash
# Check environment variables
docker-compose exec slack-bot env | grep -E "(SLACK|AZURE|OPENAI)"

# Check application logs
docker-compose logs --tail=100 slack-bot

# Check system resources
docker stats

# Kubernetes debugging
kubectl describe pod <pod-name>
kubectl exec -it <pod-name> -- /bin/sh
```

### Performance Optimization

#### 1. Database Optimization
```sql
-- Add indexes for better performance
CREATE INDEX idx_interactions_user_id ON interactions(user_id);
CREATE INDEX idx_interactions_timestamp ON interactions(timestamp);
CREATE INDEX idx_llm_interactions_created_at ON llm_interactions(created_at);
```

#### 2. Redis Optimization
```bash
# Configure Redis for better performance
# Add to redis.conf:
maxmemory 256mb
maxmemory-policy allkeys-lru
```

#### 3. Application Optimization
```bash
# Enable compression
# Set NODE_ENV=production
# Use PM2 for process management
npm install -g pm2
pm2 start src/app.js --name slack-bot
```

## Security Considerations

### 1. Environment Variables
- Never commit `.env` files to version control
- Use secrets management in production
- Rotate API keys regularly

### 2. Network Security
- Use HTTPS in production
- Configure firewall rules
- Use VPC/private networks

### 3. Database Security
- Use strong passwords
- Enable SSL connections
- Regular backups
- Access control

### 4. Application Security
- Keep dependencies updated
- Regular security audits
- Input validation
- Rate limiting

## Backup & Recovery

### 1. Database Backup
```bash
# PostgreSQL backup
docker-compose exec postgres pg_dump -U slackbot slackbot > backup.sql

# Automated backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
docker-compose exec postgres pg_dump -U slackbot slackbot > backup_$DATE.sql
```

### 2. Application Backup
```bash
# Backup configuration
tar -czf config_backup_$(date +%Y%m%d).tar.gz .env prisma/ logs/

# Backup Docker volumes
docker run --rm -v slack-bot_postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres_backup.tar.gz -C /data .
```

### 3. Recovery
```bash
# Restore database
docker-compose exec postgres psql -U slackbot -d slackbot < backup.sql

# Restore application
tar -xzf config_backup_YYYYMMDD.tar.gz
```

## Support

For additional support:
- Check the [README.md](README.md) for general information
- Review [API Documentation](API.md) for endpoint details
- Open an issue on GitHub for bugs
- Contact the development team for urgent issues 